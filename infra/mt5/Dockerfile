# Self-hosted MetaTrader 5 bridge — MT5 terminal under Wine + a tiny REST
# shim (Windows Python inside Wine, required by the MetaTrader5 package).
# No third-party services: official Wine, official mql5.com installer,
# official python.org installer. Image ~3GB, build ~10 minutes.
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive \
    WINEPREFIX=/opt/mt5 \
    WINEARCH=win64 \
    WINEDEBUG=-all \
    DISPLAY=:99

RUN dpkg --add-architecture i386 && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
      wine wine32 wine64 xvfb xauth wget ca-certificates cabextract winbind && \
    rm -rf /var/lib/apt/lists/*

# Windows Python (the MetaTrader5 package only runs on Windows Python).
ARG PYTHON_VERSION=3.11.9
RUN wget -q "https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-amd64.exe" -O /tmp/python.exe && \
    xvfb-run -a wine /tmp/python.exe /quiet InstallAllUsers=1 PrependPath=1 Include_test=0 && \
    rm /tmp/python.exe && \
    wineserver -w

RUN xvfb-run -a wine python -m pip install --no-warn-script-location MetaTrader5 && \
    wineserver -w

# MetaTrader 5 terminal (official MetaQuotes installer, silent mode).
RUN wget -q "https://download.mql5.com/cdn/web/metaquotes.software.corp/mt5/mt5setup.exe" -O /tmp/mt5setup.exe && \
    (xvfb-run -a wine /tmp/mt5setup.exe /auto || true) && \
    wineserver -w && \
    rm /tmp/mt5setup.exe && \
    test -f "$WINEPREFIX/drive_c/Program Files/MetaTrader 5/terminal64.exe"

COPY shim.py /opt/shim.py
COPY entrypoint.sh /opt/entrypoint.sh
RUN chmod +x /opt/entrypoint.sh

# REST shim port (keep it on the internal docker network only).
EXPOSE 18812

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=5 \
  CMD wget -q -O- "http://127.0.0.1:18812/health" || exit 1

ENTRYPOINT ["/opt/entrypoint.sh"]
