"""Regression tests for the container entrypoint's proxy-header configuration.

Behind Railway's edge proxy, uvicorn must trust ``X-Forwarded-For`` or every
request keys on the proxy's single IP — collapsing all per-IP rate limits and
brute-force lockouts into one global bucket. These pin that the entrypoint
passes ``--proxy-headers`` and computes ``--forwarded-allow-ips`` correctly per
deployment topology.
"""

import importlib.util
from pathlib import Path

_ENTRYPOINT = Path(__file__).resolve().parents[1] / "docker-entrypoint.py"
_spec = importlib.util.spec_from_file_location("docker_entrypoint", _ENTRYPOINT)
entrypoint = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(entrypoint)


def test_railway_trusts_the_edge_proxy():
    assert entrypoint._forwarded_allow_ips({"RAILWAY_ENVIRONMENT": "production"}) == "*"
    assert entrypoint._forwarded_allow_ips({"RAILWAY_DEPLOYMENT_ID": "abc"}) == "*"


def test_non_railway_keeps_the_safe_default():
    # Direct-publish compose / local dev: do not trust forwarded headers from
    # arbitrary clients (they would be spoofable).
    assert entrypoint._forwarded_allow_ips({}) == "127.0.0.1"


def test_explicit_override_wins_everywhere():
    assert (
        entrypoint._forwarded_allow_ips(
            {"RAILWAY_ENVIRONMENT": "production", "FORWARDED_ALLOW_IPS": "10.0.0.0/8"}
        )
        == "10.0.0.0/8"
    )
    assert (
        entrypoint._forwarded_allow_ips({"FORWARDED_ALLOW_IPS": "192.168.1.1"})
        == "192.168.1.1"
    )


def test_uvicorn_argv_enables_proxy_headers_with_trusted_ips():
    argv = entrypoint._uvicorn_argv({"RAILWAY_ENVIRONMENT": "production", "PORT": "9000"})
    assert argv[0] == "uvicorn"
    assert "--proxy-headers" in argv
    # the trusted-ips flag and its value are adjacent
    i = argv.index("--forwarded-allow-ips")
    assert argv[i + 1] == "*"
    # honours PORT and keeps graceful shutdown
    assert argv[argv.index("--port") + 1] == "9000"
    assert "--timeout-graceful-shutdown" in argv


def test_uvicorn_argv_defaults_port_and_safe_ips():
    argv = entrypoint._uvicorn_argv({})
    assert argv[argv.index("--port") + 1] == "8080"
    assert argv[argv.index("--forwarded-allow-ips") + 1] == "127.0.0.1"
