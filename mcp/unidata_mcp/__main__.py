"""Entry point para `python -m unidata_mcp` o `unidata-mcp` (stdio)."""
from __future__ import annotations

from .server import mcp


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
