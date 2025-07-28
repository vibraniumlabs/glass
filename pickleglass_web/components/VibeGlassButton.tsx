'use client';

import { useState } from 'react';
import VibeGlassWidget from './VibeGlassWidget';

interface VibeGlassButtonProps {
  incidentData: any; // Your incident data structure
}

const VibeGlassButton: React.FC<VibeGlassButtonProps> = ({ incidentData }) => {
  const [isWidgetOpen, setIsWidgetOpen] = useState(false);
  const [incidentContext, setIncidentContext] = useState('');

  const handleStartCopilot = () => {
    // Format the incident context
    const formattedContext = `
INCIDENT DETAILS:
- ID: ${incidentData?.instanceId || incidentData?.incidentId || 'Unknown'}
- Title: ${incidentData?.title || 'Untitled Incident'}
- Status: ${incidentData?.status || 'Unknown'}
- Severity: ${incidentData?.severity || 'Unknown'}
- Created: ${incidentData?.created_at ? new Date(incidentData.created_at).toLocaleString() : 'Unknown'}
- Updated: ${incidentData?.updated_at ? new Date(incidentData.updated_at).toLocaleString() : 'Unknown'}

DESCRIPTION:
${incidentData?.description || 'No description available'}

TIMELINE EVENTS:
${incidentData?.timeline ? incidentData.timeline.map((event: any) => 
  `- ${event.timestamp instanceof Date ? event.timestamp.toLocaleString() : new Date(event.timestamp).toLocaleString()}: ${event.eventType} - ${event.content}`
).join('\n') : 'No timeline events available'}

ANALYSIS:
${incidentData?.analysis?.reasoning?.midmortem || 'No analysis available'}
    `.trim();

    setIncidentContext(formattedContext);
    setIsWidgetOpen(true);
  };

  return (
    <>
      <button
        onClick={handleStartCopilot}
        className="px-6 py-3 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-xl font-semibold hover:from-blue-600 hover:to-purple-700 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-105"
      >
        🚀 Start Vibe AI Copilot
      </button>

      <VibeGlassWidget
        incidentContext={incidentContext}
        isOpen={isWidgetOpen}
        onClose={() => setIsWidgetOpen(false)}
      />
    </>
  );
};

export default VibeGlassButton; 