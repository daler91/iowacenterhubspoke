from services.observability_scrubber import ObservabilityScrubber
from core.sentry_scrub import sentry_before_send


def test_scrubber_masks_nested_request_and_exception_payloads():
    scrubber = ObservabilityScrubber()
    payload = {
        "request": {
            "headers": {"Authorization": "Bearer abc", "x-trace-id": "ok"},
            "cookies": {"session_cookie": "cookie"},
            "data": {"profile": {"email": "u@example.com", "name": "User"}},
        },
        "exception": {
            "values": [
                {"stacktrace": {"frames": [{"vars": {"refresh_token": "r1", "safe": 1}}]}}
            ]
        },
    }
    out = scrubber.scrub(payload)
    assert out["request"]["headers"]["Authorization"] == "[REDACTED]"
    assert out["request"]["headers"]["x-trace-id"] == "ok"
    assert out["request"]["cookies"] == "[REDACTED]"
    assert out["request"]["data"]["profile"]["email"] == "[REDACTED]"
    assert out["exception"]["values"][0]["stacktrace"]["frames"][0]["vars"]["refresh_token"] == "[REDACTED]"


def test_scrubber_respects_allowlist_for_known_safe_keys():
    scrubber = ObservabilityScrubber()
    payload = {"status_code": 400, "code_version": "v1", "session_id": "abc"}
    out = scrubber.scrub(payload)
    assert out["status_code"] == 400
    assert out["code_version"] == "v1"
    assert out["session_id"] == "abc"


def test_sentry_before_send_scrubs_request_and_user_sections():
    event = {
        "request": {
            "headers": {"Authorization": "Bearer abc", "X-CSRF-Token": "csrf"},
            "cookies": "session=abc",
            "data": {"token": "xyz", "nested": {"phone": "5551112222"}},
            "query_string": "code=secret&foo=bar",
        },
        "user": {"email": "u@example.com", "id": "123"},
        "extra": {"api_key": "k", "safe": "ok"},
    }
    out = sentry_before_send(event, {})
    assert out is not None
    assert out["request"]["headers"]["Authorization"] == "[REDACTED]"
    assert out["request"]["headers"]["X-CSRF-Token"] == "[REDACTED]"
    assert out["request"]["data"]["token"] == "[REDACTED]"
    assert out["request"]["data"]["nested"]["phone"] == "[REDACTED]"
    assert out["request"]["query_string"] == "code=%5BREDACTED%5D&foo=bar"
    assert out["user"]["email"] == "[REDACTED]"
    assert out["user"]["id"] == "123"
    assert out["extra"]["api_key"] == "[REDACTED]"
