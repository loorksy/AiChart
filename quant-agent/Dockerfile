FROM python:3.12.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app
COPY pyproject.toml requirements.lock README.md ./
COPY app ./app
RUN pip install --no-cache-dir -r requirements.lock \
    && groupadd --system --gid 10002 quant \
    && useradd --system --uid 10002 --gid quant --home-dir /nonexistent quant \
    && mkdir -p /var/lib/aichart-quant-agent/work \
    && chown -R quant:quant /var/lib/aichart-quant-agent \
    && chmod -R a+rX /app

USER 10002:10002
EXPOSE 8091
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8091/health/live', timeout=2)"

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8091", "--no-access-log"]
