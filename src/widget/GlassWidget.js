// A self-contained class to represent the Glass AI Widget
export default class GlassWidget {
    constructor({ onClose = () => {} } = {}) {
        this.onCloseCallback = onClose;
        this.container = null;
        this.streams = null;
    }

    // Creates the widget's HTML and appends it to the body
    _createUI() {
        this.container = document.createElement('div');
        this.container.id = 'glass-widget-container';
        this.container.innerHTML = `
            <div class="glass-widget-header">
                <span>Glass AI Assistant</span>
                <button id="glass-widget-close-btn">&times;</button>
            </div>
            <div class="glass-widget-body">
                <div id="glass-widget-permissions">
                    <p>To get started, please grant access to your screen and microphone.</p>
                    <button id="glass-widget-grant-btn">Grant Permissions</button>
                </div>
                <div id="glass-widget-main" style="display: none;">
                    <p class="status-text">Permissions granted! Ready for your command.</p>
                    <div class="button-group">
                        <button class="main-btn" id="glass-widget-ask-btn">Ask</button>
                        <button class="main-btn" id="glass-widget-listen-btn">Listen</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(this.container);
        this._applyStyles();
    }

    // Attaches event listeners to the widget's buttons
    _attachEventListeners() {
        document.getElementById('glass-widget-close-btn').addEventListener('click', () => this.hide());
        document.getElementById('glass-widget-grant-btn').addEventListener('click', () => this._requestPermissions());
        
        document.getElementById('glass-widget-ask-btn').addEventListener('click', () => {
            alert('"Ask" functionality would be implemented here.');
        });

        document.getElementById('glass-widget-listen-btn').addEventListener('click', () => {
            alert('"Listen" functionality (with LiveKit/VAPI) would be implemented here.');
        });
    }

    // Requests microphone and screen capture permissions
    async _requestPermissions() {
        const grantButton = document.getElementById('glass-widget-grant-btn');
        grantButton.disabled = true;
        grantButton.textContent = 'Requesting...';

        try {
            const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });

            this.streams = { audio: audioStream, screen: screenStream };
            console.log('Permissions granted and streams captured:', this.streams);

            // Switch to the main UI view
            document.getElementById('glass-widget-permissions').style.display = 'none';
            document.getElementById('glass-widget-main').style.display = 'block';

        } catch (error) {
            console.error('Permission denied or error:', error);
            alert(`Failed to get permissions: ${error.message}. Please try again.`);
            grantButton.disabled = false;
            grantButton.textContent = 'Grant Permissions';
        }
    }

    // Injects the widget's CSS into the document's head
    _applyStyles() {
        const style = document.createElement('style');
        style.innerHTML = `
            #glass-widget-container {
                position: fixed;
                bottom: 20px;
                right: 20px;
                width: 350px;
                background-color: #ffffff;
                border-radius: 12px;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
                z-index: 9999;
                display: none; /* Initially hidden */
                flex-direction: column;
                overflow: hidden;
                border: 1px solid #e0e0e0;
            }
            .glass-widget-header {
                background-color: #f5f5f5;
                padding: 10px 15px;
                font-weight: 600;
                color: #333;
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 1px solid #e0e0e0;
            }
            #glass-widget-close-btn {
                background: none;
                border: none;
                font-size: 24px;
                cursor: pointer;
                color: #888;
                padding: 0 5px;
            }
            #glass-widget-close-btn:hover {
                color: #333;
            }
            .glass-widget-body {
                padding: 20px;
                text-align: center;
            }
            #glass-widget-permissions p {
                margin: 0 0 15px 0;
                color: #555;
            }
            #glass-widget-grant-btn, .main-btn {
                background-color: #007bff;
                color: white;
                padding: 10px 20px;
                border: none;
                border-radius: 6px;
                cursor: pointer;
                font-size: 16px;
                width: 100%;
                transition: background-color 0.3s;
            }
            #glass-widget-grant-btn:hover, .main-btn:hover {
                background-color: #0056b3;
            }
            #glass-widget-grant-btn:disabled {
                background-color: #aaa;
                cursor: not-allowed;
            }
            .status-text {
                color: #28a745;
                font-weight: 500;
                margin-bottom: 20px;
            }
            .button-group {
                display: flex;
                gap: 10px;
            }
        `;
        document.head.appendChild(style);
    }

    // Public method to show the widget
    show() {
        if (!this.container) {
            this._createUI();
            this._attachEventListeners();
        }
        this.container.style.display = 'flex';
    }

    // Public method to hide and clean up the widget
    hide() {
        if (this.container) {
            this.container.style.display = 'none';
        }
        
        // Stop all media tracks to release the camera/microphone
        if (this.streams) {
            Object.values(this.streams).forEach(stream => {
                stream.getTracks().forEach(track => track.stop());
            });
            this.streams = null;
            console.log('Media streams stopped and released.');
        }

        this.onCloseCallback();
        
        // Optional: completely remove the widget from the DOM
        // if (this.container) {
        //     this.container.remove();
        //     this.container = null;
        // }
    }

    // Public method to check if the widget is currently visible
    isOpen() {
        return this.container && this.container.style.display !== 'none';
    }
} 