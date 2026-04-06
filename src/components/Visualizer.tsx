import { useEffect, useRef, MutableRefObject } from 'react';

interface VisualizerProps {
  audioElement: HTMLAudioElement | null;
  isPlaying: boolean;
  isDarkMode: boolean;
  audioContextRef: MutableRefObject<AudioContext | null>;
  analyserRef: MutableRefObject<AnalyserNode | null>;
  sourceRef: MutableRefObject<MediaElementAudioSourceNode | null>;
}

export default function Visualizer({ 
  audioElement, 
  isPlaying, 
  isDarkMode,
  audioContextRef,
  analyserRef,
  sourceRef
}: VisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const peaksRef = useRef<number[]>([]);

  useEffect(() => {
    if (!audioElement || !canvasRef.current) return;

    if (!audioContextRef.current) {
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContextClass) return;
        
        audioContextRef.current = new AudioContextClass();
        analyserRef.current = audioContextRef.current.createAnalyser();
        analyserRef.current.fftSize = 256;
      } catch (error) {
        console.error("Visualizer initialization failed:", error);
        return;
      }
    }

    const audioContext = audioContextRef.current;
    const analyser = analyserRef.current;

    if (!audioContext || !analyser) return;

    // Connect source if not already connected
    if (!sourceRef.current) {
      try {
        sourceRef.current = audioContext.createMediaElementSource(audioElement);
        sourceRef.current.connect(analyser);
        analyser.connect(audioContext.destination);
      } catch (e) {
        console.warn("MediaElementSource already created or failed to connect:", e);
      }
    }

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    if (peaksRef.current.length !== bufferLength) {
      peaksRef.current = new Array(bufferLength).fill(0);
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      if (canvasRef.current) {
        canvasRef.current.width = canvasRef.current.clientWidth * window.devicePixelRatio;
        canvasRef.current.height = canvasRef.current.clientHeight * window.devicePixelRatio;
      }
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      
      if (isPlaying) {
        analyser.getByteFrequencyData(dataArray);
      } else {
        // If paused, slowly decay the dataArray
        for (let i = 0; i < dataArray.length; i++) {
          dataArray[i] = Math.max(0, dataArray[i] - 5);
        }
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const drawWave = (offset: number, color: string, opacity: number, scale: number) => {
        ctx.beginPath();
        ctx.fillStyle = color;
        ctx.globalAlpha = opacity;
        
        const sliceWidth = canvas.width / (bufferLength * 0.5);
        let x = 0;

        ctx.moveTo(0, canvas.height);

        for (let i = 0; i < bufferLength * 0.5; i++) {
          const v = (dataArray[i] / 255.0) * scale;
          const y = canvas.height - (v * canvas.height * 0.8) - offset;

          if (i === 0) {
            ctx.lineTo(x, y);
          } else {
            // Bezier curve for smoother waves
            const prevV = (dataArray[i-1] / 255.0) * scale;
            const prevY = canvas.height - (prevV * canvas.height * 0.8) - offset;
            const cpX = x - sliceWidth / 2;
            ctx.bezierCurveTo(cpX, prevY, cpX, y, x, y);
          }

          x += sliceWidth;
        }

        ctx.lineTo(canvas.width, canvas.height);
        ctx.closePath();
        ctx.fill();
      };

      // Draw 3 layers of waves
      drawWave(0, '#ea580c', 0.6, 1.0);      // Primary Orange
      drawWave(5, '#7c3aed', 0.4, 0.8);      // Purple
      drawWave(10, '#16a34a', 0.3, 0.6);     // Green
      
      ctx.globalAlpha = 1.0;
    };

    if (audioContext.state === 'suspended' && isPlaying) {
      audioContext.resume();
    }
    
    draw();

    return () => {
      cancelAnimationFrame(animationRef.current);
      window.removeEventListener('resize', resizeCanvas);
    };
  }, [audioElement, isPlaying, isDarkMode]);

  return (
    <canvas 
      ref={canvasRef} 
      className="w-full h-full pointer-events-none"
    />
  );
}
