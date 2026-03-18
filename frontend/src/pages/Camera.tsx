import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";

const Camera = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((stream) => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      })
      .catch((err) => {
        console.error("Camera access denied:", err);
      });

    return () => {
      // Stop camera when leaving page
      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  return (
    <div className="relative w-screen h-screen bg-black">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="w-full h-full object-cover"
      />
      <button
        onClick={() => navigate(-1)}
        className="absolute top-4 right-4 z-10 w-10 h-10 rounded-lg bg-card shadow-md flex items-center justify-center text-foreground hover:bg-secondary transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

export default Camera;