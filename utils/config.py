"""
Configuration resolution utilities for RAAHI-Edge.
Enforces deterministic configuration precedence across all Edge components.
"""

import os
import re
from typing import Optional, Dict, Any
import yaml


DEFAULT_CENTRAL_FALLBACK = "http://localhost:5001"


def sanitize_url(url: str) -> str:
    """
    Masks credentials in URLs to prevent logging secrets.
    E.g. http://user:secret@example.com -> http://user:***@example.com
    """
    if not url:
        return ""
    # Mask password in URL authority
    return re.sub(r"://([^:@]+):([^@]+)@", r"://\1:***@", url)


def load_yaml_config(config_path: str = "config.yaml") -> Dict[str, Any]:
    """Safely loads YAML configuration file if present."""
    if not os.path.exists(config_path):
        return {}
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    except Exception as e:
        print(f"[Config Error] Failed loading {config_path}: {e}")
        return {}


def resolve_central_url(
    explicit_url: Optional[str] = None,
    config_path: str = "config.yaml",
    log_source: bool = False
) -> str:
    """
    Resolves the canonical Central API URL using strict precedence:
    1. Explicit constructor / runtime argument
    2. CENTRAL_URL environment variable
    3. config.yaml (central.url)
    4. Development fallback (http://localhost:5001)

    Returns sanitized, normalized URL with no trailing slash.
    """
    resolved_url = None
    source = "fallback"

    # 1. Explicit override
    if explicit_url and str(explicit_url).strip():
        resolved_url = str(explicit_url).strip()
        source = "explicit argument"

    # 2. Environment variable
    elif os.environ.get("CENTRAL_URL") and os.environ.get("CENTRAL_URL", "").strip():
        resolved_url = os.environ.get("CENTRAL_URL", "").strip()
        source = "CENTRAL_URL environment variable"

    # 3. config.yaml
    else:
        cfg = load_yaml_config(config_path)
        central_cfg = cfg.get("central", {})
        if isinstance(central_cfg, dict) and central_cfg.get("url"):
            val = str(central_cfg["url"]).strip()
            if val:
                resolved_url = val
                source = f"{config_path} [central.url]"

    # 4. Fallback
    if not resolved_url:
        resolved_url = DEFAULT_CENTRAL_FALLBACK
        source = "development default"

    normalized = resolved_url.rstrip("/")

    if log_source:
        sanitized = sanitize_url(normalized)
        print(f"[Config] Resolved Central URL ({source}): {sanitized}")

    return normalized
