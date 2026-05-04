import socket

import pytest
from fastapi import HTTPException

from services import webhooks


@pytest.mark.parametrize(
    "host,ip",
    [
        ("loopback.local", "127.0.0.1"),
        ("private.local", "10.0.0.8"),
        ("metadata.local", "169.254.169.254"),
        ("carrier.local", "100.64.1.1"),
    ],
)
def test_validate_webhook_url_blocks_denied_targets(monkeypatch, host, ip):
    def fake_getaddrinfo(hostname, *_args, **_kwargs):
        if hostname == host:
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 443))]
        raise socket.gaierror("not found")

    monkeypatch.setattr(webhooks.socket, "getaddrinfo", fake_getaddrinfo)

    with pytest.raises(HTTPException) as exc:
        webhooks.validate_webhook_url(f"https://{host}/hook")

    assert exc.value.status_code == 400


def test_validate_webhook_url_allows_public_https(monkeypatch):
    def fake_getaddrinfo(hostname, *_args, **_kwargs):
        assert hostname == "public.example"
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))]

    monkeypatch.setattr(webhooks.socket, "getaddrinfo", fake_getaddrinfo)

    webhooks.validate_webhook_url("https://public.example/hook")


@pytest.mark.parametrize("url", ["http://public.example/hook", "ftp://public.example/hook"])
def test_validate_webhook_url_blocks_unsafe_scheme(monkeypatch, url):
    monkeypatch.setattr(
        webhooks.socket,
        "getaddrinfo",
        lambda *_args, **_kwargs: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))],
    )

    with pytest.raises(HTTPException):
        webhooks.validate_webhook_url(url)
