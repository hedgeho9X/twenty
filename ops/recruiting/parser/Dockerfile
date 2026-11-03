FROM python:3.12-slim-bookworm AS dependencies

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/models/huggingface \
    PLAYWRIGHT_BROWSERS_PATH=/opt/playwright

RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-writer fonts-noto-cjk libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /parser/requirements.txt
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu \
    torch==2.15.0 torchvision==0.29.1
RUN pip install --no-cache-dir -r /parser/requirements.txt \
    && python -m playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*

FROM dependencies AS runtime
RUN useradd --create-home --uid 10001 parser \
    && mkdir -p /data/output /models /parser \
    && chown -R parser:parser /data /models /parser
WORKDIR /parser
COPY service.py mineru.py /parser/
USER parser
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "service:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
