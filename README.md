# Project Switchboard

Project Switchboard is a lightweight project management website focused on quick context recovery and low-friction task switching.

## Features

- Tile-based dashboard for all projects
- Fast detail view with editable project fields
- Project photo uploads stored on disk with clickable thumbnails and large preview
- Task-switch assistant with `Deep Work`, `Quick Win`, and `Admin` modes
- Recommendation rationale explaining why a project is suggested now
- Persistent backend storage in a JSON file volume
- Dockerized frontend and backend
- Jenkins pipeline for build and deployment
- Local Mac runner for pre-deploy testing

## Stack

- Frontend: React + Vite
- Backend: Node.js + Express
- Deployment: Docker Compose
- CI/CD: Jenkins

## Local development

### Option 1: Use the helper script

```bash
./run-local.sh
```

This installs dependencies if needed and starts:

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:8080/api/projects`

### Option 2: Run with Docker Compose

```bash
docker compose up --build
```

This starts:

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:8080`

## Environment variables

Copy `.env.example` to `.env` if you want to override defaults.

## Deployment

The included `Jenkinsfile` expects Docker and Docker Compose on the Ubuntu server. By default it:

1. Builds the images
2. Pulls/uses environment config
3. Deploys with `docker compose up -d --build`

Adjust the Jenkins environment variables to match your target host and registry strategy.
