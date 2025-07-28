'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import GlassAgent from '@/components/GlassAgent';

export default function GlassPage() {
  const searchParams = useSearchParams();
  const [incidentContext, setIncidentContext] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Get context from URL parameter
    const contextParam = searchParams.get('context');
    
    if (contextParam) {
      try {
        // Decode the context
        const decodedContext = decodeURIComponent(contextParam);
        setIncidentContext(decodedContext);
        console.log('📋 Received incident context:', decodedContext);
      } catch (error) {
        console.error('❌ Error decoding incident context:', error);
        setIncidentContext('Error loading incident context. Please try again.');
      }
    } else {
      // Fallback context if no context provided
      setIncidentContext('This is a sample incident context. In a real scenario, this would be dynamically loaded from the page or an API.');
    }
    
    setIsLoading(false);
  }, [searchParams]);

  const handleClose = () => {
    // Close the popup window
    if (window.opener) {
      window.close();
    } else {
      // If not a popup, redirect back to the main app
      window.history.back();
    }
  };

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-8 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading Vibe AI Copilot...</p>
        </div>
      </div>
    );
  }

  return (
    <GlassAgent 
      incidentContext={incidentContext} 
      onClose={handleClose}
    />
  );
} 