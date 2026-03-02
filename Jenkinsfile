pipeline {
  agent any

  environment {
    COMPOSE_FILE = 'docker-compose.yml'
    BACKEND_PORT = '8080'
    FRONTEND_PORT = '3000'
    CORS_ORIGIN = 'http://localhost:3000'
  }

  options {
    timestamps()
    disableConcurrentBuilds()
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Build') {
      steps {
        sh 'printf "BACKEND_PORT=%s\nFRONTEND_PORT=%s\nCORS_ORIGIN=%s\n" "$BACKEND_PORT" "$FRONTEND_PORT" "$CORS_ORIGIN" > .env'
        sh 'docker compose build'
      }
    }

    stage('Deploy') {
      steps {
        sh 'docker compose up -d --build'
      }
    }

    stage('Health Check') {
      steps {
        sh 'docker compose ps'
        sh 'curl --fail http://localhost:${BACKEND_PORT}/health'
      }
    }
  }

  post {
    always {
      sh 'docker compose ps'
    }
  }
}
