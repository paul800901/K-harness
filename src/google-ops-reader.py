"""K read-only GBP adapter. Secrets stay inside the existing AdsControl client process."""
import importlib.util
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode


def query_url(operation, args):
    fields = {
        'gbp_accounts': {'pageToken'},
        'gbp_locations': {'account', 'pageToken'},
        'gbp_reviews': {'account', 'location', 'pageToken'},
        'gbp_local_posts': {'account', 'location', 'pageToken'},
    }
    if operation not in fields or not isinstance(args, dict) or set(args) - fields[operation]:
        raise ValueError('unsupported_operation_or_arguments')
    for key, prefix in [('account', 'accounts'), ('location', 'locations')]:
        if key in fields[operation] and not re.fullmatch(prefix + r'/[A-Za-z0-9_-]+', args.get(key, '')):
            raise ValueError('invalid_resource_name')
    params = {'pageSize': 20 if operation == 'gbp_accounts' else 50}
    if 'pageToken' in args:
        if not isinstance(args['pageToken'], str) or not 1 <= len(args['pageToken']) <= 8192:
            raise ValueError('invalid_page_token')
        params['pageToken'] = args['pageToken']
    if operation == 'gbp_accounts':
        url = 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts'
    elif operation == 'gbp_locations':
        url = f"https://mybusinessbusinessinformation.googleapis.com/v1/{args['account']}/locations"
        params['readMask'] = 'name,title,storeCode,phoneNumbers,categories,storefrontAddress,websiteUri,regularHours,metadata,profile,openInfo'
    else:
        suffix = 'reviews' if operation == 'gbp_reviews' else 'localPosts'
        url = f"https://mybusiness.googleapis.com/v4/{args['account']}/{args['location']}/{suffix}"
    return url + '?' + urlencode(params)


def safe_error(error):
    # Never send raw provider errors, token fragments or stack traces to a model.
    cause = error if isinstance(error, HTTPError) else error.__cause__
    status = getattr(cause, 'code', None)
    text = str(error)
    reason = None
    if text.startswith('Google Ops API HTTP '):
        try:
            api_error = json.loads(text.partition(': ')[2]).get('error', {})
            reason = next((d.get('reason') for d in api_error.get('details', []) if d.get('reason')), None)
        except (ValueError, AttributeError):
            pass
    if isinstance(error, HTTPError):
        try:
            payload = json.loads(error.read())
            text = payload.get('error', '') if isinstance(payload, dict) else ''
        except (ValueError, OSError):
            text = ''
    code, message = 'google_api_error', 'Google 商家 API 查詢失敗；未修改資料。'
    if text == 'invalid_grant':
        code, message = 'login_required', 'Google Ops 授權已失效，須由本人重新授權；不是 Gemini Pro 登入。'
    elif 'quota_limit_value 仍是 0' in str(text):
        code, message = 'gbp_access_pending', 'Google 尚未開通此專案的商家 API 額度；不會改帳號或計費繞過。'
    elif reason == 'SERVICE_DISABLED':
        code, message = 'service_disabled', 'Google Cloud 尚未啟用 Google My Business API（mybusiness.googleapis.com）；帳號／據點可讀不代表評論與貼文 API 已開通。'
    elif status == 403:
        code, message = 'permission_denied', 'Google 拒絕此商家資源的存取；須核對商家管理權及 API 開通狀態。'
    elif status == 429:
        code, message = 'rate_limited', 'Google 商家 API 額度或速率受限；未自動重試。'
    elif isinstance(error, (URLError, TimeoutError)) or (isinstance(cause, URLError) and not isinstance(cause, HTTPError)):
        code, message = 'network_error', 'Google 連線失敗或逾時；未自動重試。'
    elif isinstance(error, (FileNotFoundError, ImportError)) or '缺少 Google Ops' in str(text):
        code, message = 'not_configured', '此工作區的 AdsControl／Google Ops 本機設定尚未完成。'
    return {'ok': False, 'code': code, 'httpStatus': status, 'message': message}


def read_google_ops(root, operation, args):
    url = query_url(operation, args)
    spec = importlib.util.spec_from_file_location('k_adscontrol_google_ops', Path(root)/'google_ops_worker'/'google_ops_client.py')
    client = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(client)
    payload = client.google_request('GET', url)
    return {'ok': True, 'operation': operation, 'fetchedAt': datetime.now(timezone.utc).isoformat(), 'data': payload}


if __name__ == '__main__':
    try:
        result = read_google_ops(sys.argv[1], sys.argv[2], json.loads(sys.argv[3]))
    except Exception as error:
        result = safe_error(error)
    print(json.dumps(result, ensure_ascii=True))
