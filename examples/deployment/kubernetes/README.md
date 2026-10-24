# Kubernetes Deployment Manifests

Production Kubernetes manifests for ViewSarn with complete container security context hardening, resource sizing, horizontal autoscaling, and Prometheus annotations.

## Prerequisites

- Kubernetes 1.25+
- Ingress controller (e.g., ingress-nginx)
- ReadWriteMany StorageClass for PVC (e.g. NFS or cloud file storage) if using `body.save: true`

## Deployment Steps

1. **Generate an API key file:**
   ```bash
   node ../../../scripts/generate-apikey.js -f apikeys.txt -c "k8s-prod"
   ```

2. **Create the Secret from the generated file:**
   ```bash
   kubectl create secret generic viewsarn-keys --from-file=apikeys.txt=./apikeys.txt
   ```

3. **Deploy using Kustomize:**
   ```bash
   kubectl apply -k .
   ```

4. **Verify deployment:**
   ```bash
   kubectl get pods -l app.kubernetes.io/name=viewsarn
   kubectl get svc viewsarn
   ```
