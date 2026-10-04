import importlib.util
import io
import json
import unittest
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse, parse_qs

spec = importlib.util.spec_from_file_location('reader', Path(__file__).resolve().parents[1]/'src/google-ops-reader.py')
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


class ReaderTest(unittest.TestCase):
    def test_fixed_get_urls_and_pagination(self):
        for operation in ['gbp_accounts', 'gbp_locations', 'gbp_reviews', 'gbp_local_posts']:
            args = {'pageToken': 'a&next=b'}
            if operation != 'gbp_accounts': args['account'] = 'accounts/123'
            if operation in ['gbp_reviews', 'gbp_local_posts']: args['location'] = 'locations/456'
            url = urlparse(reader.query_url(operation, args))
            self.assertEqual(url.scheme, 'https')
            self.assertTrue(url.hostname.endswith('.googleapis.com'))
            self.assertEqual(parse_qs(url.query)['pageToken'], ['a&next=b'])
        self.assertIn('openInfo', reader.query_url('gbp_locations', {'account': 'accounts/123'}))

    def test_no_arbitrary_commands_or_mutations(self):
        for operation, args in [('gbp_reply_review', {}), ('gbp_locations', {'account': 'accounts/../a'}), ('gbp_accounts', {'url': 'https://evil.test'}), ('gbp_reviews', {'account': 'accounts/1', 'location': 'https://evil.test'})]:
            with self.assertRaises(ValueError): reader.query_url(operation, args)

    def test_expired_login_is_not_gemini_quota(self):
        e = HTTPError('secret-url', 400, 'error', {}, io.BytesIO(b'{"error":"invalid_grant","secret":"DO_NOT_SHOW"}'))
        result = reader.safe_error(e)
        self.assertEqual(result['code'], 'login_required')
        self.assertNotIn('DO_NOT_SHOW', json.dumps(result))

    def test_google_access_and_permission_are_not_automatic_retries(self):
        self.assertEqual(reader.safe_error(RuntimeError('quota_limit_value 仍是 0'))['code'], 'gbp_access_pending')
        error = RuntimeError('private raw data')
        error.__cause__ = HTTPError('private-url', 403, 'private message', {}, None)
        result = reader.safe_error(error)
        self.assertEqual(result['code'], 'permission_denied')
        self.assertNotIn('private', json.dumps(result))

    def test_network_and_unknown_failures_never_expose_raw_text(self):
        self.assertEqual(reader.safe_error(URLError('SECRET'))['code'], 'network_error')
        wrapped = RuntimeError('Google Ops API 連線失敗：SECRET')
        wrapped.__cause__ = URLError('SECRET')
        self.assertEqual(reader.safe_error(wrapped)['code'], 'network_error')
        self.assertNotIn('SECRET', json.dumps(reader.safe_error(RuntimeError('SECRET'))))

    def test_service_disabled_preserves_cause_without_cloud_identity(self):
        error = RuntimeError('Google Ops API HTTP 403: ' + json.dumps({'error': {'details': [{'reason': 'SERVICE_DISABLED', 'metadata': {'service': 'mybusiness.googleapis.com', 'consumer': 'PRIVATE_PROJECT'}}]}}))
        error.__cause__ = HTTPError('private-url', 403, 'private message', {}, None)
        result = reader.safe_error(error)
        self.assertEqual(result['code'], 'service_disabled')
        self.assertNotIn('PRIVATE_PROJECT', json.dumps(result))


if __name__ == '__main__': unittest.main()
