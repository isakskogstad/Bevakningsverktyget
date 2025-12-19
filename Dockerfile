# Bevakningsverktyg Dockerfile
# Inkluderar Chrome för headless scraping

FROM python:3.11-slim

# Installera Chrome och dependencies
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    unzip \
    curl \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y google-chrome-stable \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Sätt environment variabler
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV HEADLESS=true

# Skapa app-katalog
WORKDIR /app

# Kopiera requirements först (för Docker layer caching)
COPY requirements.txt .

# Installera Python-dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Kopiera applikationskod
COPY . .

# Exponera port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Starta applikationen
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
