# MT5 bridge — WineHQ staging 9+ (UCRT/fetestexcept) + embed Python 3.11.
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive \
    WINEPREFIX=/opt/mt5 \
    WINEARCH=win64 \
    WINEDEBUG=-all \
    DISPLAY=:99 \
    PATH="/opt/wine-staging/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

RUN dpkg --add-architecture i386 && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
      gnupg unzip xvfb xauth wget ca-certificates cabextract winbind && \
    mkdir -pm755 /etc/apt/keyrings && \
    wget -qO /etc/apt/keyrings/winehq-archive.key https://dl.winehq.org/wine-builds/winehq.key && \
    wget -qNP /etc/apt/sources.list.d/ https://dl.winehq.org/wine-builds/ubuntu/dists/jammy/winehq-jammy.sources && \
    apt-get update && \
    apt-get install -y --install-recommends winehq-staging && \
    rm -rf /var/lib/apt/lists/*

RUN xvfb-run -a wineboot --init && wineserver -w

RUN wget -q https://dl.winehq.org/wine/wine-gecko/2.47.4/wine-gecko-2.47.4-x86_64.msi -O /tmp/gecko.msi && \
    xvfb-run -a wine msiexec /i /tmp/gecko.msi /qn && rm /tmp/gecko.msi && wineserver -w
RUN wget -q https://dl.winehq.org/wine/wine-mono/7.4.0/wine-mono-7.4.0-x86.msi -O /tmp/mono.msi && \
    xvfb-run -a wine msiexec /i /tmp/mono.msi /qn && rm /tmp/mono.msi && wineserver -w

RUN wget -q https://aka.ms/vs/17/release/vc_redist.x64.exe -O /tmp/vc64.exe && \
    xvfb-run -a wine /tmp/vc64.exe /install /quiet /norestart && rm /tmp/vc64.exe && wineserver -w

ARG PYTHON_VERSION=3.11.9
RUN mkdir -p "$WINEPREFIX/drive_c/Python311" && \
    wget -q "https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip" -O /tmp/py.zip && \
    unzip -q /tmp/py.zip -d "$WINEPREFIX/drive_c/Python311" && rm /tmp/py.zip && \
    sed -i 's/^#import site/import site/' "$WINEPREFIX/drive_c/Python311/python311._pth" && \
    wget -q https://bootstrap.pypa.io/get-pip.py -O "$WINEPREFIX/drive_c/Python311/get-pip.py"

RUN xvfb-run -a wine C:\\Python311\\python.exe C:\\Python311\\get-pip.py && wineserver -w
RUN xvfb-run -a wine C:\\Python311\\python.exe -m pip install --no-warn-script-location "numpy<2" MetaTrader5 && wineserver -w

# Fail the image build if numpy/MetaTrader5 cannot import under Wine.
RUN xvfb-run -a wine C:\\Python311\\python.exe -c "import numpy; import MetaTrader5; print('mt5-import-ok')" && wineserver -w

RUN wget -q "https://download.mql5.com/cdn/web/metaquotes.software.corp/mt5/mt5setup.exe" -O /tmp/mt5setup.exe && \
    (xvfb-run -a wine /tmp/mt5setup.exe /auto || true) && wineserver -w && rm /tmp/mt5setup.exe && \
    test -f "$WINEPREFIX/drive_c/Program Files/MetaTrader 5/terminal64.exe"

COPY shim.py /opt/shim.py
COPY entrypoint.sh /opt/entrypoint.sh
RUN sed -i 's/\r$//' /opt/entrypoint.sh && chmod +x /opt/entrypoint.sh

EXPOSE 18812

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
  CMD wget -q -O- "http://127.0.0.1:18812/health" || exit 1

ENTRYPOINT ["/opt/entrypoint.sh"]
