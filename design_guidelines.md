# Design Guidelines: Facial Photo Processing App

## Architecture Decisions

### Authentication
**Auth Required**: The app explicitly uses Replit Auth for user authentication.

**Implementation**:
- Login screen on app launch with Replit Auth integration
- Support Google, GitHub, Apple, and email/password sign-in options
- Mock the auth flow in the prototype using local state
- Profile screen includes:
  - User avatar (system-generated)
  - Display name from auth provider
  - Log out button (with confirmation alert)
  - Delete account option (nested under Settings > Account > Delete with double confirmation)
- Privacy policy & terms of service links (placeholder URLs) on login screen

### Navigation Architecture
**Root Navigation**: Tab Navigation (3 tabs)

**Tab Structure**:
1. **Gallery** (left tab) - Browse saved processed images
2. **Camera** (center tab, default) - Primary capture interface
3. **Profile** (right tab) - User settings and account management

**Navigation Flow**:
- App opens → Auth check → Camera tab (if authenticated)
- Image capture/upload → Processing screen (modal) → Tagging screen (modal) → Camera tab
- Gallery item tap → Detail view (stack push)
- Before/After link tap → Linked pair view (stack push)

---

## Screen Specifications

### 1. Login Screen
**Purpose**: Authenticate user via Replit Auth

**Layout**:
- Header: None
- Main content (centered vertically):
  - App logo/title at top
  - Tagline: "Process and organize facial photos"
  - Sign-in buttons stack (Google, GitHub, Apple, Email)
  - Privacy policy & ToS links at bottom
- Root view: Non-scrollable, centered content
- Safe area insets: top: insets.top + Spacing.xl, bottom: insets.bottom + Spacing.xl

**Components**:
- Large sign-in buttons with provider icons
- Text links for legal documents

---

### 2. Camera Tab (Main Screen)
**Purpose**: Snapchat-style camera interface for capturing or uploading photos

**Layout**:
- Header: Transparent, no navigation header
- Main content: Full-screen camera preview
- Floating elements:
  - Camera flip button (top right)
  - Flash toggle (top left)
  - Capture button (bottom center, large circular)
  - Upload from library button (bottom left, icon only)
  - Recent photo thumbnail (bottom right corner)
- Root view: Non-scrollable
- Safe area insets for floating elements:
  - Top buttons: top: insets.top + Spacing.md
  - Bottom elements: bottom: tabBarHeight + Spacing.xl

**Components**:
- Camera view component (full screen)
- Large circular capture button with subtle shadow
- Icon buttons for flip, flash, upload
- Small thumbnail preview

**Visual Design**:
- Minimal UI overlays on camera
- White icons for visibility against camera feed
- Capture button: white circle with subtle shadow (shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.10, shadowRadius: 2)

---

### 3. Processing Screen (Native Modal)
**Purpose**: Show real-time processing status after image capture/upload

**Layout**:
- Header: Custom header with "Cancel" button (left)
- Main content (centered):
  - Original image preview (small)
  - Processing animation/spinner
  - Status text: "Removing background...", "Isolating face...", "Processing complete"
- Root view: Non-scrollable, centered content
- Safe area insets: top: Spacing.xl, bottom: insets.bottom + Spacing.xl

**Components**:
- Image preview component
- Loading spinner
- Status text label

---

### 4. Tagging Screen (Native Modal)
**Purpose**: Tag processed image with metadata before saving

**Layout**:
- Header: Custom header with "Cancel" (left) and "Save" (right)
- Main content (scrollable form):
  - Processed image preview (centered, medium size)
  - Form fields:
    - "Initials" text input (2-3 Characters)
    - "Before/After" segmented control
    - "Location Code" text input
- Submit/Cancel buttons: In header
- Root view: Scrollable form
- Safe area insets: top: headerHeight + Spacing.xl, bottom: insets.bottom + Spacing.xl

**Components**:
- Image preview
- Text input fields with labels
- Segmented control (Before/After)
- Header buttons

**Form Validation**:
- All fields required before "Save" button activates
- Initials: 2-3 characters only
- Visual feedback when fields are complete

---

### 5. Gallery Tab
**Purpose**: Browse all saved processed images with tag information

**Layout**:
- Header: Default navigation header with title "Gallery" and search bar
- Main content: Grid of processed images (2-3 columns)
- Each grid item shows:
  - Processed face image (PNG with transparent background)
  - Initials badge overlay (bottom left)
  - Before/After indicator (color-coded border or badge)
- Root view: Scrollable grid
- Safe area insets: top: Spacing.xl, bottom: tabBarHeight + Spacing.xl

**Components**:
- Search bar for filtering by Initials or Location Code
- Grid layout (responsive, 2-3 columns based on screen width)
- Image cards with metadata overlays

**Visual Design**:
- Cards have subtle background for images with transparent backgrounds
- Before images: blue accent border
- After images: green accent border
- Linked pairs: small link icon indicator

---

### 6. Image Detail Screen (Stack Push from Gallery)
**Purpose**: View full image with all metadata and linking options

**Layout**:
- Header: Default navigation header with "< Back" and "Delete" (right, trash icon)
- Main content (scrollable):
  - Large processed image (centered)
  - Metadata section:
    - Initials
    - Before/After status
    - Location Code
    - Date saved
  - Link section (if Before/After):
    - "Link to Pair" button (shows list of matching initials)
    - Linked pair preview (if already linked)
- Root view: Scrollable
- Safe area insets: top: Spacing.xl, bottom: tabBarHeight + Spacing.xl

**Components**:
- Large image view
- Metadata labels
- Link/unlink buttons
- Delete confirmation alert

---

### 7. Linked Pair View Screen (Stack Push from Gallery)
**Purpose**: View Before and After images side-by-side

**Layout**:
- Header: Default navigation header with "< Back" and "Unlink" (right)
- Main content (scrollable):
  - "Before" label with image
  - Divider or arrow
  - "After" label with image
  - Shared metadata (Initials, Location Code)
- Root view: Scrollable
- Safe area insets: top: Spacing.xl, bottom: tabBarHeight + Spacing.xl

**Components**:
- Two image views (equal size, stacked vertically or side-by-side on landscape)
- Labels and divider
- Metadata section

---

### 8. Profile Tab
**Purpose**: User account and app settings

**Layout**:
- Header: Default navigation header with title "Profile"
- Main content (scrollable):
  - User info section (avatar, name from auth)
  - Settings section:
    - App preferences toggle
    - Notifications toggle
  - Account section:
    - Log out button
    - Delete account (nested link)
- Root view: Scrollable list
- Safe area insets: top: Spacing.xl, bottom: tabBarHeight + Spacing.xl

**Components**:
- Avatar (circular, from auth provider or system default)
- List items with toggles
- Destructive buttons (red text for log out/delete)

---

## Design System

### Color Palette
**Primary Colors**:
- Background: #FFFFFF (light mode), #000000 (dark mode)
- Surface: #F5F5F5 (light mode), #1C1C1E (dark mode)
- Primary Accent: #007AFF (iOS blue)
- Success/After: #34C759 (green)
- Warning/Before: #5AC8FA (blue)
- Error: #FF3B30 (red)

**Text Colors**:
- Primary: #000000 (light), #FFFFFF (dark)
- Secondary: #8E8E93
- Tertiary: #C7C7CC

### Typography
- **Headers**: SF Pro Display (iOS) / Roboto (Android), Bold, 28pt
- **Subheaders**: SF Pro Text, Semibold, 17pt
- **Body**: SF Pro Text, Regular, 15pt
- **Captions**: SF Pro Text, Regular, 12pt
- **Button Text**: SF Pro Text, Semibold, 16pt

### Spacing System
- Spacing.xs: 4pt
- Spacing.sm: 8pt
- Spacing.md: 16pt
- Spacing.lg: 24pt
- Spacing.xl: 32pt

### Component Styles
**Buttons**:
- Primary (Save, Sign In): Filled with Primary Accent color, white text, 12pt corner radius
- Secondary (Cancel): Transparent background, Primary Accent color text
- Destructive (Delete, Log Out): Red text on transparent background
- All touchable buttons have opacity feedback (activeOpacity: 0.7)

**Camera Capture Button**:
- 70pt diameter circle
- White fill with 4pt black border
- Shadow: shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.10, shadowRadius: 2

**Input Fields**:
- Border: 1pt solid #E5E5EA
- Corner radius: 8pt
- Padding: 12pt
- Focus state: Primary Accent border color

**Image Cards**:
- Corner radius: 12pt
- Background: #F9F9F9 (for transparent PNGs)
- No shadow for grid items
- Tap feedback: scale down to 0.98

### Critical Assets
1. **App Logo**: Simple icon representing face processing/anonymization
2. **Processing Animation**: Animated indicator for AI processing stages
3. **Placeholder Avatar**: Circular avatar for user profile (minimal, abstract)
4. **Link Icon**: Small icon indicating before/after linkage (e.g., chain link)

**Icon System**: Use Feather icons from @expo/vector-icons for all UI icons (camera, upload, flip, flash, trash, settings, search, etc.)

### Accessibility
- All interactive elements minimum 44pt touch target
- High contrast text (WCAG AA compliant)
- VoiceOver/TalkBack support for all screens
- Form field labels clearly associated with inputs
- Image alt text for processed face images
- Confirmation alerts for destructive actions (delete, unlink)