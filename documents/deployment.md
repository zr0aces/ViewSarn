# ViewSarn Deployment Guide

This guide covers deploying ViewSarn in various environments, from development to production.

---

## Table of Contents

1. [Development Deployment](#development-deployment)
2. [Production Deployment](#production-deployment)
3. [Cloud Platforms](#cloud-platforms)
4. [Kubernetes Deployment](#kubernetes-deployment)
5. [Monitoring and Logging](#monitoring-and-logging)
6. [Security Hardening](#security-hardening)
7. [Troubleshooting](#troubleshooting)

---

## Development Deployment

### Local Machine (Docker Compose)

**Prerequisites:**
- Docker 20.10+
- Docker Compose 2.0+

**Steps:**

1. Clone the repository:
```bash
git clone https://github.com/zr0aces/ViewSarn.git
cd ViewSarn
```

2. Create output directory:
```bash
mkdir -p output
```

3. Create API keys file (optional for dev):
```bash
cat > apikeys.txt << EOF
dev-key-1
dev-key-2
EOF
```

4. Build and start:
```bash
docker compose build
docker compose up -d
```

5. Verify:
```bash
curl http://localhost:3000/health
```

6. Test conversion:
```bash
./convert-cli.sh --file example.html --api-key dev-key-1 --output test.pdf
```

---

## Production Deployment

### Single Server with Docker Compose

**Recommended for:**
- Small to medium workloads
- Single region deployments
- Cost-sensitive projects

#### docker-compose.yml (Production)

```yaml
version: "3.8"

services:
  viewsarn:
    build: .
    image: viewsarn:latest
    container_name: viewsarn
    ports:
      - "127.0.0.1:3000:3000"  # Bind to localhost only
    environment:
      - PORT=3000
      - OUTPUT_DIR=/output
      - API_KEYS_FILE=/app/apikeys.txt
      - RATE_LIMIT_MAX=200
      - RATE_LIMIT_WINDOW_MS=60000
      - LOG_LEVEL=info
      - NODE_ENV=production
    volumes:
      - ./output:/output
      - ./apikeys.txt:/app/apikeys.txt:ro
    shm_size: "2gb"
    restart: always
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    deploy:
      resources:
        limits:
          memory: 3G
          cpus: '2'
        reservations:
          memory: 1G
          cpus: '1'
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

#### Nginx Reverse Proxy

**nginx.conf:**

```nginx
upstream viewsarn_backend {
    server 127.0.0.1:3000;
}

server {
    listen 80;
    server_name viewsarn.example.com;
    
    # Redirect to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name viewsarn.example.com;
    
    # SSL Configuration
    ssl_certificate /etc/letsencrypt/live/viewsarn.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/viewsarn.example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    
    # Request size limit (for large HTML payloads)
    client_max_body_size 20M;
    
    # Timeouts (PDF generation can take time)
    proxy_connect_timeout 90s;
    proxy_send_timeout 90s;
    proxy_read_timeout 90s;
    
    location / {
        proxy_pass http://viewsarn_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Rate limiting (additional layer)
        limit_req zone=viewsarn_limit burst=20 nodelay;
    }
    
    location /health {
        proxy_pass http://viewsarn_backend;
        access_log off;
    }
}

# Rate limit zone definition (add to http block)
limit_req_zone $binary_remote_addr zone=viewsarn_limit:10m rate=10r/s;
```

#### Setup Script

```bash
#!/bin/bash
# deploy.sh - Production deployment script

set -e

echo "🚀 Deploying ViewSarn to Production..."

# Generate strong API keys
echo "📝 Generating API keys..."
cat > apikeys.txt << EOF
$(openssl rand -hex 32)
$(openssl rand -hex 32)
$(openssl rand -hex 32)
EOF
chmod 600 apikeys.txt

# Create output directory
mkdir -p output
chmod 755 output

# Pull latest code
git pull origin main

# Build Docker image
docker compose build

# Stop old container
docker compose down

# Start new container
docker compose up -d

# Wait for health check
echo "⏳ Waiting for service to be healthy..."
sleep 10

# Check health
if curl -f http://localhost:3000/health > /dev/null 2>&1; then
    echo "✅ Deployment successful!"
    echo "API Keys stored in apikeys.txt (keep secure!)"
else
    echo "❌ Health check failed!"
    docker compose logs
    exit 1
fi
```

---

## Cloud Platforms

### AWS ECS Deployment

#### Task Definition (JSON)

```json
{
  "family": "viewsarn",
  "containerDefinitions": [
    {
      "name": "viewsarn",
      "image": "your-ecr-repo/viewsarn:latest",
      "portMappings": [
        {
          "containerPort": 3000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {
          "name": "PORT",
          "value": "3000"
        },
        {
          "name": "OUTPUT_DIR",
          "value": "/output"
        },
        {
          "name": "RATE_LIMIT_MAX",
          "value": "200"
        },
        {
          "name": "LOG_LEVEL",
          "value": "info"
        }
      ],
      "secrets": [
        {
          "name": "API_KEY",
          "valueFrom": "arn:aws:secretsmanager:region:account:secret:viewsarn-api-key"
        }
      ],
      "mountPoints": [
        {
          "sourceVolume": "output",
          "containerPath": "/output"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/viewsarn",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "viewsarn"
        }
      },
      "memory": 2048,
      "cpu": 1024,
      "linuxParameters": {
        "sharedMemorySize": 1024
      },
      "healthCheck": {
        "command": ["CMD-SHELL", "curl -f http://localhost:3000/health || exit 1"],
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 60
      }
    }
  ],
  "volumes": [
    {
      "name": "output",
      "efsVolumeConfiguration": {
        "fileSystemId": "fs-12345678",
        "transitEncryption": "ENABLED",
        "authorizationConfig": {
          "accessPointId": "fsap-12345678"
        }
      }
    }
  ],
  "requiresCompatibilities": ["FARGATE"],
  "networkMode": "awsvpc",
  "cpu": "1024",
  "memory": "2048"
}
```

### Google Cloud Run

#### Dockerfile (Cloud Run optimized)

```dockerfile
# Use the existing Dockerfile, no changes needed
# Cloud Run automatically handles port binding
```

#### Deploy Command

```bash
# Build and push to GCR
gcloud builds submit --tag gcr.io/PROJECT_ID/viewsarn

# Deploy to Cloud Run
gcloud run deploy viewsarn \
  --image gcr.io/PROJECT_ID/viewsarn \
  --platform managed \
  --region us-central1 \
  --memory 2Gi \
  --cpu 2 \
  --timeout 90s \
  --max-instances 10 \
  --set-env-vars PORT=3000,OUTPUT_DIR=/output \
  --set-secrets API_KEY=viewsarn-api-key:latest \
  --allow-unauthenticated
```

### Azure Container Instances

```bash
# Create resource group
az group create --name viewsarn-rg --location eastus

# Create container
az container create \
  --resource-group viewsarn-rg \
  --name viewsarn \
  --image your-acr.azurecr.io/viewsarn:latest \
  --cpu 2 \
  --memory 4 \
  --ports 3000 \
  --environment-variables \
    PORT=3000 \
    OUTPUT_DIR=/output \
    RATE_LIMIT_MAX=200 \
  --secure-environment-variables \
    API_KEY=your-secret-key \
  --dns-name-label viewsarn \
  --restart-policy Always
```

---

## Kubernetes Deployment

### Deployment Manifest

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: viewsarn
  namespace: default
spec:
  replicas: 3
  selector:
    matchLabels:
      app: viewsarn
  template:
    metadata:
      labels:
        app: viewsarn
    spec:
      containers:
      - name: viewsarn
        image: your-registry/viewsarn:latest
        ports:
        - containerPort: 3000
          name: http
        env:
        - name: PORT
          value: "3000"
        - name: OUTPUT_DIR
          value: /output
        - name: RATE_LIMIT_MAX
          value: "200"
        - name: RATE_LIMIT_WINDOW_MS
          value: "60000"
        - name: LOG_LEVEL
          value: info
        - name: API_KEY
          valueFrom:
            secretKeyRef:
              name: viewsarn-secrets
              key: api-key
        volumeMounts:
        - name: output
          mountPath: /output
        - name: shm
          mountPath: /dev/shm
        resources:
          requests:
            memory: "1Gi"
            cpu: "500m"
          limits:
            memory: "3Gi"
            cpu: "2000m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 30
          timeoutSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 10
          timeoutSeconds: 5
      volumes:
      - name: output
        persistentVolumeClaim:
          claimName: viewsarn-output-pvc
      - name: shm
        emptyDir:
          medium: Memory
          sizeLimit: 1Gi
---
apiVersion: v1
kind: Service
metadata:
  name: viewsarn
  namespace: default
spec:
  type: LoadBalancer
  ports:
  - port: 80
    targetPort: 3000
    protocol: TCP
  selector:
    app: viewsarn
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: viewsarn-output-pvc
spec:
  accessModes:
    - ReadWriteMany
  resources:
    requests:
      storage: 100Gi
  storageClassName: nfs-storage
---
apiVersion: v1
kind: Secret
metadata:
  name: viewsarn-secrets
type: Opaque
stringData:
  api-key: your-generated-secret-key-here
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: viewsarn-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: viewsarn
  minReplicas: 3
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

### Deploy to Kubernetes

```bash
# Save the above manifests to k8s/ directory, then apply
mkdir -p k8s
# (Save manifests to k8s/deployment.yaml)

# Apply manifests
kubectl apply -f k8s/

# Check deployment
kubectl get pods -l app=viewsarn
kubectl get svc viewsarn

# View logs
kubectl logs -l app=viewsarn --tail=100 -f

# Check health
kubectl port-forward svc/viewsarn 3000:80
curl http://localhost:3000/health
```

---

## Monitoring and Logging

### Prometheus Metrics (Future Enhancement)

While ViewSarn doesn't currently expose Prometheus metrics, you can add them:

```javascript
// Install prom-client
npm install prom-client

// Add to server.js
const promClient = require('prom-client');
const register = new promClient.Registry();

// Define metrics
const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status']
});

register.registerMetric(httpRequestDuration);

// Expose /metrics endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
```

### Log Aggregation

**ELK Stack:**

```yaml
# docker-compose.yml additions
  elasticsearch:
    image: elasticsearch:8.11.0
    environment:
      - discovery.type=single-node
    ports:
      - "9200:9200"
  
  logstash:
    image: logstash:8.11.0
    volumes:
      - ./logstash.conf:/usr/share/logstash/pipeline/logstash.conf
    depends_on:
      - elasticsearch
  
  kibana:
    image: kibana:8.11.0
    ports:
      - "5601:5601"
    depends_on:
      - elasticsearch

# Update viewsarn service
  viewsarn:
    logging:
      driver: "syslog"
      options:
        syslog-address: "tcp://logstash:5000"
        tag: "viewsarn"
```

---

## Security Hardening

### 1. Network Security

```bash
# Firewall rules (UFW)
sudo ufw allow 22/tcp     # SSH
sudo ufw allow 80/tcp     # HTTP
sudo ufw allow 443/tcp    # HTTPS
sudo ufw deny 3000/tcp    # Block direct access to app
sudo ufw enable
```

### 2. API Key Management

```bash
# Generate strong keys
openssl rand -hex 32

# Store in secrets manager (AWS example)
aws secretsmanager create-secret \
  --name viewsarn/api-keys \
  --secret-string "$(cat apikeys.txt)"

# Rotate keys regularly (every 90 days)
```

### 3. Docker Security

```yaml
# Run as non-root (already implemented)
USER www-data

# Read-only filesystem where possible
security_opt:
  - no-new-privileges:true
read_only: true
tmpfs:
  - /tmp

# Drop capabilities
cap_drop:
  - ALL
cap_add:
  - NET_BIND_SERVICE
```

### 4. Rate Limiting Best Practices

```javascript
// Use Redis for distributed rate limiting
const Redis = require('ioredis');
const redis = new Redis(process.env.REDIS_URL);

// Implement sliding window rate limiter
// (requires code modification)
```

---

## Troubleshooting

### Issue: Container Crashes on Startup

**Symptoms:**
- Container exits immediately
- `docker logs` shows browser launch errors

**Solutions:**
```bash
# Increase shared memory
docker run --shm-size=2gb ...

# Check Chromium dependencies
docker exec -it viewsarn bash
npx playwright install-deps
```

### Issue: Out of Memory

**Symptoms:**
- Container crashes under load
- OOM killer messages in logs

**Solutions:**
```yaml
# Increase memory limits
deploy:
  resources:
    limits:
      memory: 4G

# Reduce concurrent requests
environment:
  - RATE_LIMIT_MAX=50

# Add swap (host level)
sudo fallocate -l 4G /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

### Issue: Slow Response Times

**Symptoms:**
- Requests take >10 seconds
- High CPU usage

**Solutions:**
```bash
# Scale horizontally
docker compose up --scale viewsarn=3

# Optimize HTML (reduce complexity)
# Use caching for repeated content
# Pre-warm browser instance
```

### Issue: Health Check Failures

**Symptoms:**
- Load balancer removes instances
- Container marked unhealthy

**Solutions:**
```yaml
# Increase timeout and start period
healthcheck:
  timeout: 15s
  start_period: 60s
  retries: 5
```

---

## Backup and Disaster Recovery

### Output Files Backup

```bash
# Backup script
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
tar -czf "backup_${DATE}.tar.gz" output/
aws s3 cp "backup_${DATE}.tar.gz" s3://your-bucket/backups/

# Retention: keep last 30 days
find . -name "backup_*.tar.gz" -mtime +30 -delete
```

### Database-less Recovery

ViewSarn is stateless, so recovery is simple:
1. Deploy new instance
2. Restore API keys
3. Restore `/output` directory (optional)

---

## Performance Tuning

### Recommended Settings

**For High Throughput:**
```yaml
environment:
  - RATE_LIMIT_MAX=500
  - RATE_LIMIT_WINDOW_MS=60000
deploy:
  replicas: 5
  resources:
    limits:
      memory: 4G
      cpus: '2'
```

**For Large Documents:**
```yaml
environment:
  - NODE_OPTIONS=--max-old-space-size=4096
shm_size: "3gb"
```

**For Fast Response:**
```yaml
# Pre-warm browser (code modification needed)
# Use keep-alive connections
# Enable HTTP/2
```

---

## Conclusion

ViewSarn can be deployed in various environments with minimal configuration. Choose the deployment strategy that fits your needs:

- **Development**: Docker Compose locally
- **Small Production**: Single server with Nginx
- **Medium Production**: Cloud PaaS (Cloud Run, ECS)
- **Large Production**: Kubernetes with auto-scaling

Always enable authentication, use HTTPS, and monitor your deployment for optimal performance and security.
