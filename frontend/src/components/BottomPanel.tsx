const BottomPanel = () => {
  return (
    <div className="w-full h-full bg-card flex flex-col" style={{ boxShadow: 'var(--panel-shadow)' }}>
      {/* Drag handle */}
      <div className="flex justify-center pt-3 pb-2">
        <div className="w-10 h-1 rounded-full bg-border" style={{ background: `hsl(var(--handle-bg))` }} />
      </div>

      {/* Empty content area */}
      <div className="flex-1 px-4 pb-4" />
    </div>
  );
};

export default BottomPanel;
