FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy conductor module
COPY . .

# Health check endpoint (optional - implement if needed)
EXPOSE 8080

# Run conductor
CMD ["python", "-m", "conductor"]
