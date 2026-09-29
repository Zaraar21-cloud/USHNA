"""
USHNA API entry point (backward-compatibility shim).
Delegates directly to api.main.

Supports running:
    uvicorn src.main:app --host 0.0.0.0 --port 8000
as specified in the starter deployment guide, while maintaining full
parity with the edge stack API in api.main.
"""
from api.main import *  # noqa: F401, F403
from api.main import app

__all__ = ["app"]
