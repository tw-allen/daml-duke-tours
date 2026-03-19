import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X, Camera as CameraIcon } from "lucide-react";

const BUILDINGS = [
  { id: "perkins_library", name: "Perkins Library" },
  { id: "broadhead_center", name: "Broadhead Center" },
  { id: "duke_chapel", name: "Duke Chapel" },
  { id: "bryan_center", name: "Bryan Center" },
  { id: "wilson_recreation_center", name: "Wilson Recreation Center" },
  { id: "wilkinson_building", name: "Wilkinson Building" },
];

const Camera = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const navigate = useNavigate();
  const [photo, setPhoto] = useState<string | null>(null);
  const [selectedBuilding, setSelectedBuilding] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const handleCapture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    setPhoto(canvas.toDataURL("image/jpeg"));
  };

  const handleGetBlurb = async () => {
    if (!selectedBuilding) return;
    setLoading(true);

    try {
      const res = await fetch("https://daml-duke-tours.onrender.com/generate-building-blurb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ building_id: selectedBuilding }),
      });

      const data = await res.json();
      console.log("Backend response:", data); // add this


      // Save blurb to localStorage so Chat can pick it up
      localStorage.setItem("pending_blurb", data.blurb);
      console.log("Saved to localStorage:", data.blurb); // add this
      navigate("/");
    } catch (err) {
      console.error("Error fetching blurb:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative w-screen h-screen bg-black">
      {/* Camera feed */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className={`w-full h-full object-cover ${photo ? "hidden" : ""}`}
      />
      <canvas ref={canvasRef} className="hidden" />

      {/* Photo preview */}
      {photo && (
        <img src={photo} className="w-full h-full object-cover absolute inset-0" />
      )}

      {/* Close button */}
      <button
        onClick={() => navigate(-1)}
        className="absolute top-4 right-4 z-10 w-10 h-10 rounded-lg bg-card shadow-md flex items-center justify-center text-foreground hover:bg-secondary transition-colors"
      >
        <X className="w-4 h-4" />
      </button>

      {/* Capture button */}
      {!photo && (
        <button
          onClick={handleCapture}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 w-16 h-16 rounded-full bg-white shadow-lg flex items-center justify-center"
        >
          <CameraIcon className="w-6 h-6 text-black" />
        </button>
      )}

      {/* Building selector + blurb button */}
      {photo && (
        <div className="absolute bottom-0 left-0 right-0 bg-card rounded-t-2xl p-4 flex flex-col gap-3">
          <p className="text-sm font-semibold text-foreground">Which building is this?</p>
          <div className="flex flex-col gap-2">
            {BUILDINGS.map((b) => (
              <button
                key={b.id}
                onClick={() => setSelectedBuilding(b.id)}
                className={`text-sm px-4 py-2 rounded-lg border transition-colors ${
                  selectedBuilding === b.id
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-secondary text-foreground border-border"
                }`}
              >
                {b.name}
              </button>
            ))}
          </div>
          <button
            onClick={handleGetBlurb}
            disabled={!selectedBuilding || loading}
            className="bg-primary text-primary-foreground rounded-lg py-2 text-sm font-semibold disabled:opacity-50"
          >
            {loading ? "Loading..." : "Get Tour Info"}
          </button>
          <button
            onClick={() => setPhoto(null)}
            className="text-sm text-muted-foreground text-center"
          >
            Retake photo
          </button>
        </div>
      )}
    </div>
  );
};

export default Camera;