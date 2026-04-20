import '@mantine/core/styles.css'
import '@mantine/dates/styles.css'
import '@mantine/notifications/styles.css'
import { StrictMode } from 'react'
import { createTheme, MantineProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const theme = createTheme({
  primaryColor: 'blue',
  defaultRadius: 'sm',
  radius: {
    xs: '0.2rem',
    sm: '0.32rem',
    md: '0.45rem',
    lg: '0.55rem',
    xl: '0.7rem',
  },
  fontFamily:
    '"Inter", "SF Pro Display", "Segoe UI Variable", "Helvetica Neue", sans-serif',
  headings: {
    fontFamily:
      '"Inter", "SF Pro Display", "Segoe UI Variable", "Helvetica Neue", sans-serif',
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="light">
      <Notifications position="bottom-right" limit={4} />
      <App />
    </MantineProvider>
  </StrictMode>,
)
