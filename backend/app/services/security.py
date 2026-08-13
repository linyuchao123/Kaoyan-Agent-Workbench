import asyncio
import ipaddress
import socket
from collections.abc import Awaitable, Callable
from urllib.parse import urlparse


class UnsafeUrlError(ValueError):
    pass


def validate_public_url(url: str) -> str:
    """Reject obvious SSRF targets before a URL is queued for extraction."""
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise UnsafeUrlError("only public http or https URLs can be imported")
    hostname = parsed.hostname.rstrip(".").lower()
    if hostname == "localhost" or hostname.endswith(".localhost"):
        raise UnsafeUrlError("local network URLs cannot be imported")
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        return url
    if not address.is_global:
        raise UnsafeUrlError("private, loopback and reserved network URLs cannot be imported")
    return url


async def validate_resolved_public_url(
    url: str,
    resolver: Callable[[str, int], Awaitable[list[tuple]]] | None = None,
) -> str:
    validated = validate_public_url(url)
    parsed = urlparse(validated)
    hostname = parsed.hostname or ""
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    if resolver is None:

        async def default_resolver(host: str, target_port: int) -> list[tuple]:
            return await asyncio.to_thread(
                socket.getaddrinfo,
                host,
                target_port,
                type=socket.SOCK_STREAM,
            )

        resolver = default_resolver
    try:
        addresses = await resolver(hostname, port)
    except OSError as error:
        raise UnsafeUrlError("URL hostname could not be resolved") from error
    if not addresses:
        raise UnsafeUrlError("URL hostname could not be resolved")
    for address_info in addresses:
        address = ipaddress.ip_address(address_info[4][0])
        if not address.is_global:
            raise UnsafeUrlError("URL hostname resolves to a non-public network")
    return validated


def contains_prompt_injection(text: str) -> bool:
    """Cheap first-pass signal; flagged chunks still remain untrusted evidence."""
    lowered = text.casefold()
    markers = (
        "ignore previous instructions",
        "ignore all instructions",
        "system prompt",
        "developer message",
        "调用工具",
        "忽略之前的指令",
        "忽略以上指令",
        "执行以下命令",
    )
    return any(marker in lowered for marker in markers)
