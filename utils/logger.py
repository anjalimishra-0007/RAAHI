"""Logging utility module for RAAHI Edge.

Provides standardized, colorized, thread-safe console logging.
"""

import logging
import sys
from typing import Optional


class ANSIColorFormatter(logging.Formatter):
    """Custom logging formatter adding ANSI color codes for terminal readability."""

    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"

    COLORS = {
        logging.DEBUG: "\033[36m",     # Cyan
        logging.INFO: "\033[32m",      # Green
        logging.WARNING: "\033[33m",   # Yellow
        logging.ERROR: "\033[31m",     # Red
        logging.CRITICAL: "\033[1;31m" # Bold Red
    }

    def format(self, record: logging.LogRecord) -> str:
        color = self.COLORS.get(record.levelno, self.RESET)
        timestamp = self.formatTime(record, "%Y-%m-%d %H:%M:%S")
        level_name = f"{record.levelname:<7}"
        module_name = f"[{record.name}]"

        # Check if terminal supports color
        if sys.stdout.isatty():
            formatted = (
                f"{self.DIM}{timestamp}{self.RESET} "
                f"{color}{self.BOLD}{level_name}{self.RESET} "
                f"{self.DIM}{module_name:<16}{self.RESET} "
                f"{record.getMessage()}"
            )
        else:
            formatted = f"{timestamp} {level_name} {module_name:<16} {record.getMessage()}"

        if record.exc_info:
            formatted += "\n" + self.formatException(record.exc_info)
        return formatted


def setup_logger(name: str = "raahi-edge", level: str = "INFO") -> logging.Logger:
    """Configures and returns the root or named application logger."""
    logger = logging.getLogger(name)
    numeric_level = getattr(logging, level.upper(), logging.INFO)
    logger.setLevel(numeric_level)

    # Avoid adding duplicate handlers if setup is called multiple times
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setLevel(numeric_level)
        handler.setFormatter(ANSIColorFormatter())
        logger.addHandler(handler)

    logger.propagate = False
    return logger


def get_logger(name: str = "raahi-edge") -> logging.Logger:
    """Returns an existing logger instance."""
    return logging.getLogger(name)
