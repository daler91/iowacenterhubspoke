🧪 Add tests for Outlook email/calendar sync failures

🎯 What: Added tests to explicitly verify error recovery paths in the Outlook service when HTTP client interactions fail.
📊 Coverage: Tested `check_outlook_availability`, `create_outlook_event`, `delete_outlook_event`, `_get_access_token_client_credentials`, and `_refresh_outlook_oauth_token` for HTTP client failure handling, verifying empty arrays/None are returned and warnings/exceptions are properly logged.
✨ Result: Increased test coverage for the critical error handling path missing explicit tests. Added protections to ensure global modules are not polluted by the test cases.
