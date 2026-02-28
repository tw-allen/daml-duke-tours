import MapView from "@/components/MapView";
import BottomSheet from "@/components/BottomSheet";

const Index = () => {
  return (
    <div className="h-[100dvh] w-screen overflow-hidden bg-background relative">
      <div className="absolute inset-0">
        <MapView />
      </div>
      <BottomSheet />
    </div>
  );
};

export default Index;
