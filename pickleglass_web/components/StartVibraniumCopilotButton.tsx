import React from 'react';

interface IncidentData {
  instanceId?: number;  // Changed from string to number to match Vibe data
  incidentId?: number;  // Changed from string to number to match Vibe data
  title?: string;
  status?: string;
  severity?: string;
  created_at?: string;
  updated_at?: string;
  description?: string;
  timeline?: Array<{
    timestamp: Date;  // Changed from string to Date to match Vibe data
    eventType: string;
    content: string;
  }>;
  analysis?: {
    reasoning?: {
      midmortem?: string;
    };
  };
}

interface FallbackIncidentData {
  incidentId: string;
  service: string;
  timestamp: string;
  description: string;
  logs: string[];
  customerImpact: string;
  assignedTo: string;
}

const StartCopilotButton = ({ incidentData }: { incidentData: IncidentData }) => {
  const handleStartCopilot = () => {
    // 1. Define the incident context data.
    const fallbackData: FallbackIncidentData = {
      incidentId: "INC-456",
      service: "api-gateway",
      timestamp: new Date().toISOString(),
      description: "Users are experiencing intermittent 503 errors.",
      logs: [
        "ERROR: Upstream service unavailable.",
        "INFO: Request routing failed for path /v1/users.",
      ],
      customerImpact: "Medium",
      assignedTo: "ops-team@example.com"
    };

    const incidentContext = incidentData || fallbackData;

    // Log the incident data being sent to Glass for debugging
    console.log("Raw incident data received:", incidentData);
    console.log("Sending incident data to Glass:", incidentContext);

    // 2. Format the incident context for our web Glass agent
    const formattedContext = `
INCIDENT DETAILS:
- ID: ${'instanceId' in incidentContext ? incidentContext.instanceId?.toString() : incidentContext.incidentId?.toString() || 'Unknown'}
- Title: ${'title' in incidentContext ? incidentContext.title : 'Untitled Incident'}
- Status: ${'status' in incidentContext ? incidentContext.status : 'Unknown'}
- Severity: ${'severity' in incidentContext ? incidentContext.severity : 'Unknown'}
- Created: ${'created_at' in incidentContext && incidentContext.created_at ? new Date(incidentContext.created_at).toLocaleString() : 'Unknown'}
- Updated: ${'updated_at' in incidentContext && incidentContext.updated_at ? new Date(incidentContext.updated_at).toLocaleString() : 'Unknown'}

DESCRIPTION:
${'description' in incidentContext ? incidentContext.description : 'No description available'}

TIMELINE EVENTS:
${'timeline' in incidentContext && incidentContext.timeline ? incidentContext.timeline.map(event => 
  `- ${event.timestamp instanceof Date ? event.timestamp.toLocaleString() : new Date(event.timestamp).toLocaleString()}: ${event.eventType} - ${event.content}`
).join('\n') : 'No timeline events available'}

ANALYSIS:
${'analysis' in incidentContext && incidentContext.analysis?.reasoning?.midmortem ? incidentContext.analysis.reasoning.midmortem : 'No analysis available'}
    `.trim();

    // 3. URL-encode the context for safe transmission
    const encodedContext = encodeURIComponent(formattedContext);

    // 4. Construct the URL for our Glass widget
    const glassWebUrl = `http://localhost:3001/widget?context=${encodedContext}`;
    
    console.log('🔗 Glass web URL:', glassWebUrl);

    // 5. Open the Glass widget in a popup window
    const popup = window.open(
      glassWebUrl,
      'vibe-ai-copilot',
      'width=1000,height=700,scrollbars=no,resizable=yes,toolbar=no,menubar=no,location=no,status=no'
    );

    // 6. Focus the popup if it was successfully opened
    if (popup) {
      popup.focus();
      console.log('✅ Glass web agent opened successfully');
    } else {
      console.error('❌ Failed to open Glass web agent popup');
      // Fallback: try to open in same window
      window.location.href = glassWebUrl;
    }
  };

  return (
    <button
      onClick={handleStartCopilot}
      style={{
        padding: '12px 24px',
        fontSize: '16px',
        cursor: 'pointer',
        backgroundColor: '#6c5ce7',
        color: 'white',
        border: 'none',
        borderRadius: '8px',
        fontWeight: 'bold',
        boxShadow: '0 4px 14px 0 rgba(0, 0, 0, 0.1)'
      }}
    >
      Start Vibe AI Copilot
    </button>
  );
};

export default StartCopilotButton; 