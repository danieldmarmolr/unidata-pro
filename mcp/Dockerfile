# UNIDATA MCP — HTTP/SSE transport
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Copia el paquete + pyproject + readme (necesarios para pip install -e)
COPY pyproject.toml README.md ./
COPY unidata_mcp ./unidata_mcp

RUN pip install --no-cache-dir .

EXPOSE 8765
ENV PORT=8765
CMD ["sh", "-c", "unidata-mcp-http"]
