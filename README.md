# saas-kit

[![Watch the video](https://img.youtube.com/vi/TWQv_tr5ABI/maxresdefault.jpg)](https://www.youtube.com/watch?v=TWQv_tr5ABI&t=1s)

A monorepo SaaS application with user-facing frontend and data service backend.

## Setup

```bash
bun run setup
```

This installs all dependencies and builds required packages.

## Development

### User Application
```bash
bun run dev:user-application
```

### Data Service
```bash
bun run dev:data-service
```

## Deployment

### User Application (Cloudflare)
```bash
bun run deploy:user-application
```

### Data Service
```bash
bun run deploy:data-service
```

## Working with Individual Apps

You can also navigate into any sub-application directory and work with it independently in your IDE:

```bash
cd apps/user-application
# Open in your preferred IDE
```
