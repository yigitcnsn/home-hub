# Home Hub - Smart Dashboard

A modern, modular web dashboard for home automation and monitoring.

## Features

- **Modern UI Design**: Beautiful gradient-based interface with smooth animations
- **Modular System**: Easily add, remove, and customize modules
- **Drag & Drop**: Reorder modules by dragging them around
- **Local Storage**: All modules are saved locally in your browser
- **Responsive**: Works on desktop, tablet, and mobile devices
- **Multiple Module Types**: Temperature, Lighting, Security, Energy, Weather, and Custom modules
- **Instance Management**: One instance per widget type ensures consistency
- **Developer Tools**: Clear all widgets for development and testing

## Getting Started

1. Open `index.html` in your web browser
2. Click the "Add Module" button to create your first module
3. Choose a name, type, and size for your module
4. Drag modules around to rearrange them

## Module Types

- **Temperature**: Monitor room temperatures
- **Lighting**: Control and monitor lighting levels
- **Security**: Security system status
- **Energy**: Energy consumption monitoring
- **Weather**: Weather information
- **System Monitor**: Raspberry Pi health with visual graphs (CPU, memory, disk, network, temperature) - **Persistent widget**
- **Custom**: Custom modules for any purpose

## Module Sizes

- **Small (1x1)**: Compact module for simple data
- **Medium (2x1)**: Standard width module
- **Large (2x2)**: Large module for detailed information

## System Monitoring

The dashboard includes a persistent system monitor widget that provides real-time health monitoring of your Raspberry Pi:

### Features
- **Visual Progress Bars**: CPU, memory, and disk usage with color-coded status
- **Temperature Gauge**: CPU temperature with color indicators (green/yellow/red)
- **Real-time Updates**: Refreshes every 5 seconds across all connected devices
- **Network Status**: Connection monitoring with status indicators
- **Uptime Tracking**: System runtime display

### Metrics Monitored
- CPU usage percentage and temperature
- Memory usage (RAM) with total/used breakdown
- Disk space utilization with capacity display
- Network connectivity status
- System uptime duration

## File Structure

```
home-hub/
├── index.html      # Main HTML structure
├── styles.css      # All styling and animations
├── script.js       # Module management and interactivity
└── README.md       # This file
```

## Customization

The dashboard is built with CSS custom properties (variables) defined in `styles.css`. You can easily customize colors, spacing, and other design elements by modifying the `:root` variables.

## Browser Support

Works in all modern browsers that support:
- CSS Grid
- Flexbox
- Local Storage
- Drag and Drop API

## Cross-Device Synchronization

The dashboard supports real-time synchronization across multiple devices using WebSocket technology.

### Quick Start

1. **Install Node.js** (download from nodejs.org)
2. **Install dependencies:**
   ```bash
   npm install
   ```
3. **Start the sync server:**
   ```bash
   npm start
   ```
4. **Open multiple browser tabs** to `http://localhost:3000` or access from different devices on your network
5. **Test sync**: Add/edit widgets on one device and watch them appear on others instantly

### Accessing from Other Devices

- **Same computer**: Open `http://localhost:3000` in multiple browser tabs
- **Same network**: Use your computer's IP address (e.g., `http://192.168.1.100:3000`)
- **Different networks**: Would require port forwarding and a domain name

### Troubleshooting

- **Server won't start**: Make sure port 3000 is available
- **Can't connect from other devices**: Check firewall settings and network configuration
- **Sync indicator shows disconnected**: Server may not be running or WebSocket blocked

### How It Works

- **Real-time Sync**: Uses WebSocket connections for instant updates
- **Fallback Support**: Falls back to polling if WebSocket is unavailable
- **Instance-based**: Only shared widget instances sync between devices
- **Conflict-free**: Last update wins for simultaneous changes

### Architecture

- **Frontend**: JavaScript client with WebSocket support
- **Backend**: Node.js server with Express and WebSocket
- **Protocol**: JSON messages for state synchronization
- **Storage**: In-memory server state (persists while server runs)

## Developer Features

The sidebar includes a developer section with tools for development and testing:

- **Clear All Widgets**: Removes all modules and instances, resetting the dashboard to a clean state. Useful for testing and development.

## Future Enhancements

- Real-time data integration
- Module templates
- Theme customization
- Export/import configurations
- Widget marketplace
- Cross-device synchronization

