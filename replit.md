# DE-ID Face

## Overview

DE-ID Face is a cross-platform mobile application built with React Native/Expo for facial photo processing, anonymization, and organization. The app allows users to capture photos, process faces using AI-powered anonymization, tag and organize photos, and track before/after comparisons with improvement scoring.

The architecture follows a monorepo structure with a React Native frontend (`client/`) and an Express.js backend (`server/`), sharing types and schemas through a common module (`shared/`).

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React Native with Expo SDK 54
- **Navigation**: React Navigation v7 with nested navigators
  - Root Stack: Handles auth flow (Login) and modal screens (Processing, Tagging, LinkPhoto)
  - Tab Navigator: Three tabs - Gallery, Camera (default), Profile
  - Stack Navigators: Each tab has its own stack for screen hierarchy
- **State Management**: TanStack React Query for server state, React Context for auth
- **Styling**: React Native StyleSheet with a custom theming system (light/dark modes)
- **Key Libraries**: 
  - expo-camera for photo capture
  - expo-image-picker for gallery uploads
  - react-native-reanimated for animations
  - react-native-gesture-handler for touch handling

### Backend Architecture
- **Framework**: Express.js with TypeScript
- **API Pattern**: RESTful JSON API at `/api/*` routes
- **Session Management**: express-session for auth state
- **Face Processing Pipeline**:
  1. Face detection using face-api.js with TensorFlow.js
  2. AI-powered anonymization via OpenAI GPT-4o for face analysis and DALL-E for generation
  3. Photo standardization using OpenAI GPT-4o to normalize lighting, sizing, zoom, and centering (512x512 output)
  4. Improvement scoring via AWS Rekognition using standardized images for consistent comparisons

### Data Layer
- **Database**: PostgreSQL with Drizzle ORM
- **Schema**: Two main tables - `users` and `photos`
- **Relationships**: Users have many photos; photos can link to other photos (before/after pairs)
- **Migrations**: Managed via drizzle-kit with `db:push` command

### Authentication
- **Method**: Replit Auth integration with fallback dev login
- **Client Storage**: AsyncStorage for persisting auth state
- **Server Validation**: Session-based with X-User-Id header support for mobile clients

### Path Aliases
- `@/*` maps to `./client/*`
- `@shared/*` maps to `./shared/*`

## External Dependencies

### Third-Party Services
- **OpenAI API**: Used for face analysis (GPT-4o) and anonymized portrait generation (DALL-E)
  - Configured via `AI_INTEGRATIONS_OPENAI_BASE_URL` and `AI_INTEGRATIONS_OPENAI_API_KEY`
- **AWS Rekognition**: Calculates improvement scores between before/after photo pairs
  - Requires `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
- **Replit Auth**: OAuth provider for user authentication
  - Uses Replit's userinfo endpoint for token validation

### Database
- **PostgreSQL**: Primary data store
  - Connection via `DATABASE_URL` environment variable
  - Schema managed through Drizzle ORM

### ML Models
- **face-api.js models**: SSD MobileNetV1 and Face Landmark 68 models stored in `server/models/`
  - Auto-downloaded from GitHub if missing
  - Used for local face detection before AI processing

### Environment Variables Required
- `DATABASE_URL`: PostgreSQL connection string
- `AI_INTEGRATIONS_OPENAI_BASE_URL`: OpenAI API base URL
- `AI_INTEGRATIONS_OPENAI_API_KEY`: OpenAI API key
- `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`: AWS credentials for Rekognition
- `EXPO_PUBLIC_DOMAIN`: Public domain for API calls from mobile client