# GitHub Actions Docker Workflow - Implementation Summary

## Overview

This document describes the GitHub Actions workflow that automatically builds and publishes ViewSarn Docker images to GitHub Container Registry (GHCR).

## Workflow File

**Location:** `.github/workflows/docker-publish.yml`

## Triggers

The workflow runs automatically when:

1. **Release Published**: When a new release is published on GitHub
2. **Tag Push**: When a tag matching the pattern `v*` is pushed (e.g., `v1.0.0`, `v2.1.3`)

## What It Does

The workflow performs the following steps:

1. **Checkout**: Clones the repository code
2. **Setup Docker Buildx**: Prepares Docker for efficient multi-platform builds
3. **Login to GHCR**: Authenticates to GitHub Container Registry using `GITHUB_TOKEN`
4. **Extract Metadata**: Generates appropriate tags and labels based on the version
5. **Build & Push**: Builds the Docker image and pushes it to GHCR

## Image Tags

For a release tagged `v1.2.3`, the workflow creates the following tags:

- `ghcr.io/zr0aces/viewsarn:1.2.3` - Full semantic version
- `ghcr.io/zr0aces/viewsarn:1.2` - Major.minor version
- `ghcr.io/zr0aces/viewsarn:1` - Major version only
- `ghcr.io/zr0aces/viewsarn:latest` - Latest release

## Using Pre-built Images

### Pull the Image

```bash
# Pull latest version
docker pull ghcr.io/zr0aces/viewsarn:latest

# Pull specific version
docker pull ghcr.io/zr0aces/viewsarn:1.0.0
```

### Run with Docker

```bash
docker run -d \
  -p 3000:3000 \
  -v $(pwd)/output:/output \
  -e API_KEY=your-secret-key \
  --shm-size=1gb \
  ghcr.io/zr0aces/viewsarn:latest
```

### Use in Docker Compose

```yaml
version: "3.8"
services:
  viewsarn:
    image: ghcr.io/zr0aces/viewsarn:latest
    ports:
      - "3000:3000"
    environment:
      - API_KEY=your-secret-key
      - OUTPUT_DIR=/output
    volumes:
      - ./output:/output
    shm_size: "1gb"
```

## Creating a Release

To trigger the workflow and publish a new Docker image:

### Option 1: GitHub UI

1. Go to the repository on GitHub
2. Click on "Releases" → "Draft a new release"
3. Create a new tag (e.g., `v1.0.0`)
4. Fill in the release title and description
5. Click "Publish release"

The workflow will automatically start and build the Docker image.

### Option 2: Command Line

```bash
# Create and push a tag
git tag v1.0.0
git push origin v1.0.0

# The workflow will trigger automatically
```

Then create the release on GitHub UI or use `gh` CLI:

```bash
gh release create v1.0.0 --title "Version 1.0.0" --notes "Release notes here"
```

## Monitoring Workflow Runs

To view workflow runs:

1. Go to the repository on GitHub
2. Click on the "Actions" tab
3. Select "Docker Build and Publish" workflow
4. View the status of recent runs

## Permissions

The workflow has the following permissions:

- `contents: read` - To read repository code
- `packages: write` - To publish to GitHub Container Registry

No additional secrets or configuration needed - `GITHUB_TOKEN` is automatically provided.

## Image Visibility

By default, images published to GHCR inherit the repository's visibility:

- **Public repository** → Public images (anyone can pull)
- **Private repository** → Private images (requires authentication)

To change image visibility:

1. Go to `https://github.com/orgs/zr0aces/packages`
2. Find the `viewsarn` package
3. Click "Package settings"
4. Change visibility as needed

## Caching

The workflow uses GitHub Actions cache to speed up builds:

- `cache-from: type=gha` - Restore cache from previous builds
- `cache-to: type=gha,mode=max` - Save all layers to cache

This significantly reduces build time for subsequent runs.

## Troubleshooting

### Workflow Fails to Push

**Error:** `denied: permission_denied`

**Solution:** Ensure the repository has package publishing enabled and `GITHUB_TOKEN` has `packages: write` permission.

### Image Not Found

**Error:** `Error response from daemon: manifest for ghcr.io/zr0aces/viewsarn:latest not found`

**Solution:** 
1. Verify workflow has run successfully at least once
2. Check that the image is public or you're authenticated
3. Authenticate if needed: `docker login ghcr.io -u <username> -p <token>`

### Build Fails

**Error:** Build errors during workflow execution

**Solution:**
1. Check the workflow logs in the Actions tab
2. Ensure the Dockerfile is correct
3. Verify all required files (fonts, source code) are present
4. Test the build locally: `docker build -t viewsarn:test .`

## Best Practices

1. **Semantic Versioning**: Use proper semantic version tags (e.g., `v1.2.3`)
2. **Release Notes**: Include meaningful release notes for each version
3. **Pre-release Testing**: Test builds locally before creating releases
4. **Tag Consistency**: Always prefix tags with `v` (e.g., `v1.0.0`, not `1.0.0`)
5. **Changelog**: Maintain a CHANGELOG.md documenting version changes

## Security

- The workflow uses official GitHub Actions from trusted sources
- `GITHUB_TOKEN` is automatically provided by GitHub (no manual secrets needed)
- Images are scanned during build (via Docker Buildx)
- No sensitive data is baked into images

## Future Enhancements

Possible improvements to consider:

1. **Multi-architecture builds** - Support ARM64 (Apple Silicon, ARM servers)
2. **Image signing** - Sign images with Cosign for supply chain security
3. **Vulnerability scanning** - Add Trivy or Snyk for automated security scans
4. **Build notifications** - Send notifications on build success/failure
5. **Performance metrics** - Track build times and image sizes

## References

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Docker Buildx Action](https://github.com/docker/build-push-action)
- [Docker Metadata Action](https://github.com/docker/metadata-action)
- [GitHub Container Registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
