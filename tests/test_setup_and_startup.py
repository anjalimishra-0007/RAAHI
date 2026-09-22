"""
tests/test_setup_and_startup.py
===============================
Automated test suite verifying the RAAHI-Edge first-run setup and startup system:
1. Scripts exist and are executable (setup.sh, start.sh).
2. Bash syntax validation (bash -n).
3. No hardcoded personal IP addresses in source code or tracked configs.
4. Central URL precedence and fallback integrity.
5. Setup script idempotency and configuration preservation.
6. Runtime directories and model weight integrity.
7. Startup script pre-flight checks (./start.sh --check).
8. Dashboard production build verification.
"""

import os
import re
import stat
import subprocess
import tempfile
from pathlib import Path
import pytest
import yaml

from utils.config import resolve_central_url, load_yaml_config

PROJECT_ROOT = Path(__file__).resolve().parent.parent


class TestSetupAndStartup:
    """Test suite for RAAHI-Edge setup and startup automation."""

    def test_01_scripts_exist_and_are_executable(self):
        """Verify setup.sh and start.sh exist and have execute permissions."""
        setup_sh = PROJECT_ROOT / "setup.sh"
        start_sh = PROJECT_ROOT / "start.sh"

        assert setup_sh.exists(), "setup.sh must exist in repository root"
        assert start_sh.exists(), "start.sh must exist in repository root"

        setup_mode = setup_sh.stat().st_mode
        start_mode = start_sh.stat().st_mode

        assert bool(setup_mode & stat.S_IXUSR), "setup.sh must be executable by user"
        assert bool(start_mode & stat.S_IXUSR), "start.sh must be executable by user"

    def test_02_bash_script_syntax_validity(self):
        """Verify bash syntax validity using bash -n for both scripts."""
        for script_name in ["setup.sh", "start.sh"]:
            script_path = PROJECT_ROOT / script_name
            res = subprocess.run(
                ["bash", "-n", str(script_path)],
                capture_output=True,
                text=True,
            )
            assert res.returncode == 0, f"Syntax error in {script_name}:\n{res.stderr}"

    def test_03_no_hardcoded_personal_ip_in_source_or_config(self):
        """
        Verify that no developer's personal machine LAN IP (e.g. 192.168.x.x, 10.x.x.x)
        is hardcoded into source code, YAML configs, scripts, or tracked files.
        (Only dynamic detection, localhost/127.0.0.1, or DNS probes 8.8.8.8 are permitted).
        """
        tracked_extensions = [".py", ".sh", ".yaml", ".yml", ".json", ".js", ".jsx"]
        exclude_dirs = {"venv", ".venv", "node_modules", "dist", ".git", "__pycache__", "tests"}

        # Regex for private IP patterns (excluding 127.0.0.1 and 0.0.0.0)
        private_ip_pattern = re.compile(
            r"\b(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2[0-9]|3[0-1])\.\d{1,3}\.\d{1,3})\b"
        )

        violations = []
        for path in PROJECT_ROOT.rglob("*"):
            if any(part in exclude_dirs for part in path.parts):
                continue
            if path.suffix in tracked_extensions and path.is_file():
                content = path.read_text(errors="ignore")
                matches = private_ip_pattern.findall(content)
                if matches:
                    violations.append(f"{path.relative_to(PROJECT_ROOT)}: {matches}")

        assert not violations, (
            f"Found hardcoded personal/private IP addresses in source files:\n"
            + "\n".join(violations)
        )

    def test_04_central_url_resolution_and_precedence(self, monkeypatch):
        """
        Verify Central URL resolution precedence:
        1. Explicit constructor argument
        2. CENTRAL_URL environment variable
        3. config.yaml
        4. Fallback (http://localhost:5001)
        """
        # Tier 1: Explicit argument
        assert resolve_central_url(explicit_url="https://custom.raahi.io") == "https://custom.raahi.io"

        # Tier 2: CENTRAL_URL environment variable
        monkeypatch.setenv("CENTRAL_URL", "https://env.raahi.io")
        assert resolve_central_url() == "https://env.raahi.io"

        # Tier 3: config.yaml fallback (when env var is removed)
        monkeypatch.delenv("CENTRAL_URL", raising=False)
        cfg_from_file = load_yaml_config(str(PROJECT_ROOT / "config.yaml"))
        expected_config_url = cfg_from_file.get("central", {}).get("url", "http://localhost:5001")
        assert resolve_central_url(config_path=str(PROJECT_ROOT / "config.yaml")) == expected_config_url

        # Tier 4: Localhost development fallback
        with tempfile.TemporaryDirectory() as tmpdir:
            missing_cfg = os.path.join(tmpdir, "missing.yaml")
            assert resolve_central_url(config_path=missing_cfg) == "http://localhost:5001"

    def test_05_runtime_directories_and_configs_exist(self):
        """Verify all required runtime directories and config files exist."""
        required_dirs = [
            PROJECT_ROOT / "data",
            PROJECT_ROOT / "data" / "evidence",
            PROJECT_ROOT / "captures",
            PROJECT_ROOT / "models",
            PROJECT_ROOT / "dashboard",
        ]
        for d in required_dirs:
            assert d.is_dir(), f"Required directory {d} missing"

        # Models
        pothole_model = PROJECT_ROOT / "models" / "pothole_yolo11n.pt"
        traffic_model = PROJECT_ROOT / "models" / "yolo11n.pt"
        assert pothole_model.is_file(), "Pothole model weights missing"
        assert traffic_model.is_file(), "Traffic model weights missing"

        # Configs
        mediamtx_cfg = PROJECT_ROOT / "mediamtx.yml"
        edge_cfg = PROJECT_ROOT / "config.yaml"
        assert mediamtx_cfg.is_file(), "mediamtx.yml missing"
        assert edge_cfg.is_file(), "config.yaml missing"

        # Validate config.yaml parses as valid YAML
        with open(edge_cfg, "r") as f:
            parsed = yaml.safe_load(f)
            assert isinstance(parsed, dict)
            assert "stream" in parsed
            assert "camera" in parsed
            assert "central" in parsed

    def test_06_setup_idempotency_and_config_preservation(self):
        """
        Verify that running setup.sh multiple times does NOT overwrite
        or destroy existing configuration or data.
        """
        env_file = PROJECT_ROOT / ".env"
        original_content = env_file.read_text() if env_file.exists() else None

        try:
            # Write a marker in .env
            marker_content = "# Test Marker\nCENTRAL_URL=https://raahi.feminismindia.com\nTEST_FLAG=1\n"
            env_file.write_text(marker_content)

            # Run setup.sh
            res = subprocess.run(
                [str(PROJECT_ROOT / "setup.sh")],
                capture_output=True,
                text=True,
                cwd=str(PROJECT_ROOT),
            )
            assert res.returncode == 0, f"setup.sh failed on second run:\n{res.stderr}"

            # Check that existing .env was preserved (not overwritten)
            current_content = env_file.read_text()
            assert "TEST_FLAG=1" in current_content, "setup.sh must not overwrite existing .env file"
            assert "Preserving existing .env configuration file." in res.stdout
        finally:
            if original_content is not None:
                env_file.write_text(original_content)
            else:
                env_file.unlink(missing_ok=True)

    def test_07_start_script_preflight_check_mode(self):
        """
        Verify that ./start.sh --check performs non-destructive environment
        validation and exits with 0 without starting server daemons.
        """
        res = subprocess.run(
            [str(PROJECT_ROOT / "start.sh"), "--check"],
            capture_output=True,
            text=True,
            cwd=str(PROJECT_ROOT),
        )
        assert res.returncode == 0, f"start.sh --check failed:\n{res.stderr}"
        assert "All pre-flight startup checks PASSED" in res.stdout
        assert "Outbound Central Endpoint :" in res.stdout
        assert "Local Machine LAN IP      :" in res.stdout

    def test_08_dashboard_production_build_exists(self):
        """Verify that dashboard/dist contains built index.html and assets."""
        dist_dir = PROJECT_ROOT / "dashboard" / "dist"
        index_html = dist_dir / "index.html"
        assets_dir = dist_dir / "assets"

        assert dist_dir.is_dir(), "dashboard/dist directory should exist"
        assert index_html.is_file(), "dashboard/dist/index.html should exist"
        assert assets_dir.is_dir(), "dashboard/dist/assets should exist"
