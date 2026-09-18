import json
import logging
import re
import sys
from datetime import datetime, timezone
from typing import Any, Dict, Optional


class SensitiveDataFilter(logging.Filter):
    """Filter that sanitizes credentials, passwords, and tokens from log records."""

    PATTERNS = [
        (re.compile(r'(api_key|apikey|secret|password|token|authorization)=([^\s&]+)', re.IGNORECASE), r'\1=[REDACTED]'),
        (re.compile(r'Bearer\s+[A-Za-z0-9\-\._~\+\/]+=*', re.IGNORECASE), r'Bearer [REDACTED]'),
        (re.compile(r'postgres(ql)?://([^:]+):([^@]+)@', re.IGNORECASE), r'postgresql://\2:[REDACTED]@'),
    ]

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            for pattern, repl in self.PATTERNS:
                record.msg = pattern.sub(repl, record.msg)
        if record.args:
            if isinstance(record.args, dict):
                sanitized_dict = {}
                for k, v in record.args.items():
                    val = v
                    if isinstance(val, str):
                        for pattern, repl in self.PATTERNS:
                            val = pattern.sub(repl, val)
                    sanitized_dict[k] = val
                record.args = sanitized_dict
            elif isinstance(record.args, tuple):
                sanitized_tuple = []
                for a in record.args:
                    val = a
                    if isinstance(val, str):
                        for pattern, repl in self.PATTERNS:
                            val = pattern.sub(repl, val)
                    sanitized_tuple.append(val)
                record.args = tuple(sanitized_tuple)
        return True


class JsonLogFormatter(logging.Formatter):
    """Structured JSON formatter for production container log aggregators."""

    def format(self, record: logging.LogRecord) -> str:
        payload: Dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "service": "skyguard-backend",
            "logger": record.name,
            "message": record.getMessage(),
            "module": record.module,
            "line": record.lineno,
        }
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        # Include extra context if available
        if hasattr(record, "station_id"):
            payload["station_id"] = record.station_id
        if hasattr(record, "source"):
            payload["source"] = record.source
        if hasattr(record, "event_id"):
            payload["event_id"] = record.event_id
        return json.dumps(payload)


def setup_logging(
    log_level: str = "INFO",
    log_file: Optional[str] = None,
    log_format: str = "text",
) -> None:
    """Configure root logger and application loggers."""
    numeric_level = getattr(logging, log_level.upper(), logging.INFO)
    
    if log_format.lower() == "json":
        formatter: logging.Formatter = JsonLogFormatter()
    else:
        formatter = logging.Formatter(
            fmt="%(asctime)s [%(levelname)s] [%(name)s] %(message)s",
            datefmt="%Y-%m-%dT%H:%M:%SZ"
        )

    filter_sensitive = SensitiveDataFilter()
    handlers: list[logging.Handler] = []

    class AutoFlushStreamHandler(logging.StreamHandler):
        def emit(self, record: logging.LogRecord) -> None:
            super().emit(record)
            self.flush()

    # Console Handler (stdout) with instant flushing
    console_handler = AutoFlushStreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    console_handler.addFilter(filter_sensitive)
    handlers.append(console_handler)

    # Optional File Handler
    if log_file:
        file_handler = logging.FileHandler(log_file, encoding="utf-8")
        file_handler.setFormatter(formatter)
        file_handler.addFilter(filter_sensitive)
        handlers.append(file_handler)

    # Configure root logger
    logging.basicConfig(
        level=numeric_level,
        handlers=handlers,
        force=True
    )

    # Keep informative access logs
    logging.getLogger("uvicorn.access").setLevel(logging.INFO)


def get_logger(name: str) -> logging.Logger:
    """Obtain a namespaced logger instance."""
    return logging.getLogger(f"skyguard.{name}")
