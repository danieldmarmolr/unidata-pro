# UNIDATA backend - FastAPI
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# Dependencias del sistema (postgres client, ssh)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 build-essential libpq-dev openssh-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Deps Python (capa cacheable)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Codigo
COPY app ./app

# Dir donde Railway monta el volumen persistente (audit.db, users.db)
# Nota: Railway no soporta el directive VOLUME, el mount se configura en la UI/CLI

# La SSH key se inyecta como variable de entorno BASTION_KEY_*_BASE64 (multi-line),
# y el entrypoint la escribe a un path conocido al iniciar.
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8000
ENTRYPOINT ["/entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips=*"]
