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
- **Custom**: Custom modules for any purpose

## Module Sizes

- **Small (1x1)**: Compact module for simple data
- **Medium (2x1)**: Standard width module
- **Large (2x2)**: Large module for detailed information

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

