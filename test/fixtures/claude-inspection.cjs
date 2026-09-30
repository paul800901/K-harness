// Fake CLI inspection only; no network or provider account.
const args=process.argv.slice(2);
if(args.includes('--version'))console.log('2.1.280');
else if(args.includes('--help'))console.log('auth status');
else if(args.includes('status'))console.log(JSON.stringify({loggedIn:process.env.K_TEST_CLAUDE_LOGGED_IN==='1',authMethod:'claude.ai',subscriptionType:'pro',apiProvider:'firstParty'}));
else process.exitCode=1;
