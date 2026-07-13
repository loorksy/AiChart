FROM python:3.12.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app
COPY pyproject.toml requirements.lock README.md ./
COPY app ./app
RUN pip install --no-cache-dir -r requirements.lock \
    && groupadd --system --gid 10001 research \
    && useradd --system --uid 10001 --gid research --home-dir /nonexistent research \
    && mkdir -p /var/lib/aichart-research/work /var/lib/aichart-research/artifacts \
    && chown -R research:research /var/lib/aichart-research

USER 10001:10001
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8090/health/live', timeout=2)"

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8090", "--no-access-log"]
