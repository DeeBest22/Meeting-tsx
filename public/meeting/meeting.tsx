import { useState, useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Mic, 
  MicOff, 
  Video, 
  VideoOff, 
  PhoneOff, 
  Volume2, 
  VolumeX,
  MonitorUp,
  MessageSquare,
  Users,
  MoreVertical,
  Settings,
  SwitchCamera,
  Send,
  X,
  Pin,
  Crown,
  Smile,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff
} from "lucide-react";

// Sample video URLs for demonstration
const SAMPLE_VIDEOS = [
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4",
];

// ============= Interfaces =============
interface Reaction {
  id: string;
  emoji: string;
}

interface Message {
  id: string;
  sender: string;
  text: string;
  time: string;
  isLocal?: boolean;
}

interface Participant {
  id: string;
  name: string;
  isMuted: boolean;
  isVideoOff?: boolean;
  isLocal?: boolean;
  isHost?: boolean;
  isPinned?: boolean;
  isActiveSpeaker?: boolean;
  videoUrl?: string;
}

// ============= FloatingReaction Component =============
interface FloatingReactionProps {
  emoji: string;
  id: string;
  onComplete: (id: string) => void;
}

const FloatingReaction = ({ emoji, id, onComplete }: FloatingReactionProps) => {
  const [isVisible, setIsVisible] = useState(true);
  const randomX = Math.random() * 80 + 10;
  
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false);
      onComplete(id);
    }, 3000);
    
    return () => clearTimeout(timer);
  }, [id, onComplete]);

  return (
    <div
      className={cn(
        "fixed text-5xl pointer-events-none z-50 transition-all duration-3000 ease-out",
        isVisible ? "opacity-100" : "opacity-0"
      )}
      style={{
        left: `${randomX}%`,
        bottom: "20%",
        animation: "float 3s ease-out forwards",
      }}
    >
      {emoji}
    </div>
  );
};

// ============= DraggableSelfView Component =============
interface DraggableSelfViewProps {
  videoUrl?: string;
  name: string;
  isMuted: boolean;
  isVideoOff: boolean;
}

const DraggableSelfView = ({ name, isMuted, isVideoOff }: DraggableSelfViewProps) => {
  const [position, setPosition] = useState({ x: window.innerWidth - 180, y: 80 });
  const [isDragging, setIsDragging] = useState(false);
  const [isHidden, setIsHidden] = useState(false);
  const [showHideZone, setShowHideZone] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const dragRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef({ x: 0, y: 0 });

  // Get user camera - keeps running even when hidden
  useEffect(() => {
    const getCamera = async () => {
      if (isVideoOff) return; // Don't start camera if video is off
      
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { facingMode: 'user' },
          audio: false 
        });
        setLocalStream(stream);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error("Error accessing camera:", err);
      }
    };

    getCamera();

    return () => {
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Handle camera on/off when video button is toggled
  useEffect(() => {
    const manageCamera = async () => {
      if (isVideoOff) {
        // Stop camera when video is turned off
        if (localStream) {
          localStream.getTracks().forEach(track => track.stop());
          setLocalStream(null);
          if (videoRef.current) {
            videoRef.current.srcObject = null;
          }
        }
      } else {
        // Start camera when video is turned on
        if (!localStream) {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
              video: { facingMode: 'user' },
              audio: false 
            });
            setLocalStream(stream);
            if (videoRef.current) {
              videoRef.current.srcObject = stream;
            }
          } catch (err) {
            console.error("Error accessing camera:", err);
          }
        }
      }
    };

    manageCamera();
  }, [isVideoOff]);

  // Keep video connected when unhiding
  useEffect(() => {
    if (videoRef.current && localStream && !isHidden) {
      videoRef.current.srcObject = localStream;
    }
  }, [localStream, isHidden]);

  const HIDE_ZONE_HEIGHT = 100;
  const BUTTON_AREA_HEIGHT = 140; // Height reserved for bottom buttons

  const getHideZone = () => ({
    x: window.innerWidth / 2 - 100,
    width: 200,
    y: window.innerHeight - HIDE_ZONE_HEIGHT - 20,
    height: HIDE_ZONE_HEIGHT,
  });

  const isInHideZone = (x: number, y: number) => {
    const zone = getHideZone();
    return (
      x >= zone.x &&
      x <= zone.x + zone.width &&
      y >= zone.y &&
      y <= zone.y + zone.height
    );
  };

  const constrainPosition = (x: number, y: number) => {
    const maxX = window.innerWidth - 144; // 144 = 36 (w-36) * 4
    const maxY = window.innerHeight - BUTTON_AREA_HEIGHT - 192; // 192 = 48 (h-48) * 4
    
    return {
      x: Math.max(16, Math.min(x, maxX)),
      y: Math.max(16, Math.min(y, maxY))
    };
  };

  const handleStart = (clientX: number, clientY: number, e: any) => {
    if (isHidden) return;
    e.preventDefault();
    e.stopPropagation();
    
    setIsDragging(true);
    offsetRef.current = {
      x: clientX - position.x,
      y: clientY - position.y,
    };
  };

  const handleMove = (clientX: number, clientY: number) => {
    if (!isDragging) return;
    
    const newX = clientX - offsetRef.current.x;
    const newY = clientY - offsetRef.current.y;
    
    const constrained = constrainPosition(newX, newY);
    setPosition(constrained);
    setShowHideZone(isInHideZone(constrained.x + 72, constrained.y + 96));
  };

  const handleEnd = () => {
    if (!isDragging) return;
    
    if (isInHideZone(position.x + 72, position.y + 96)) {
      setIsHidden(true);
    }
    setIsDragging(false);
    setShowHideZone(false);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    handleStart(e.clientX, e.clientY, e);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    handleStart(touch.clientX, touch.clientY, e);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      handleMove(e.clientX, e.clientY);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (isDragging) {
        e.preventDefault();
        const touch = e.touches[0];
        handleMove(touch.clientX, touch.clientY);
      }
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleEnd);
      document.addEventListener('touchmove', handleTouchMove, { passive: false });
      document.addEventListener('touchend', handleEnd);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleEnd);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleEnd);
    };
  }, [isDragging, position]);

  if (isHidden) {
    return (
      <Button
        onClick={() => setIsHidden(false)}
        className="fixed bottom-6 right-24 z-50 h-12 w-12 rounded-2xl bg-control-bg/90 backdrop-blur-xl hover:bg-control-hover shadow-elevation border border-border/50 transition-all duration-300 hover:scale-110"
      >
        <Eye className="h-5 w-5" />
      </Button>
    );
  }

  const hideZone = getHideZone();

  return (
    <>
      {/* Hide Zone Indicator */}
      {showHideZone && (
        <div
          className="fixed z-40 flex items-center justify-center bg-destructive/20 border-2 border-dashed border-destructive rounded-3xl backdrop-blur-sm transition-all duration-300 animate-scale-in"
          style={{
            left: `${hideZone.x}px`,
            top: `${hideZone.y}px`,
            width: `${hideZone.width}px`,
            height: `${hideZone.height}px`,
          }}
        >
          <div className="flex flex-col items-center gap-2">
            <EyeOff className="h-6 w-6 text-destructive" />
            <span className="text-sm font-medium text-destructive">Drop to hide</span>
          </div>
        </div>
      )}

      {/* Draggable Self View */}
      <div
        ref={dragRef}
        className={cn(
          "fixed z-50 w-36 h-48 rounded-2xl overflow-hidden shadow-elevation border-2 border-primary/50 cursor-move select-none",
          isDragging ? "scale-105 shadow-glow transition-none" : "transition-all duration-200",
          showHideZone && "opacity-50"
        )}
        style={{
          left: `${position.x}px`,
          top: `${position.y}px`,
          touchAction: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
      >
        {localStream && !isVideoOff ? (
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="absolute inset-0 w-full h-full object-cover scale-x-[-1]"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-primary to-accent">
            <div className="text-3xl font-bold text-white opacity-90 mb-2">
              {name.charAt(0).toUpperCase()}
            </div>
            {isVideoOff && (
              <div className="flex items-center gap-2 bg-black/40 px-3 py-1.5 rounded-full backdrop-blur-sm">
                <VideoOff className="w-4 h-4 text-white" />
                <span className="text-xs text-white font-medium">Camera Off</span>
              </div>
            )}
          </div>
        )}

        <div className="absolute top-2 left-2 right-2 flex items-center justify-between">
          <span className="text-xs font-medium text-white bg-black/40 px-2 py-0.5 rounded-full backdrop-blur-sm pointer-events-none">
            {name}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsHidden(true);
            }}
            className="flex items-center justify-center w-6 h-6 rounded-full bg-black/40 backdrop-blur-sm hover:bg-black/60 transition-colors pointer-events-auto"
          >
            <EyeOff className="w-3 h-3 text-white" />
          </button>
        </div>

        <div className="absolute bottom-2 left-2 pointer-events-none">
          <div className={cn(
            "flex items-center justify-center w-6 h-6 rounded-full transition-all duration-300",
            isMuted ? "bg-destructive" : "bg-success"
          )}>
            {isMuted ? (
              <MicOff className="w-3 h-3 text-white" />
            ) : (
              <Mic className="w-3 h-3 text-white" />
            )}
          </div>
        </div>
      </div>
    </>
  );
};

// ============= ReactionBar Component =============
const reactions = ["👍", "❤️", "😂", "🎉", "👏", "🔥", "😮", "👋"];

interface ReactionBarProps {
  onReaction: (emoji: string) => void;
}

const ReactionBar = ({ onReaction }: ReactionBarProps) => {
  const [isOpen, setIsOpen] = useState(false);

  const handleReaction = (emoji: string) => {
    onReaction(emoji);
    setIsOpen(false);
  };

  return (
    <div className="fixed top-6 right-6 z-50">
      <Button
        onClick={() => setIsOpen(!isOpen)}
        variant="ghost"
        size="icon"
        className={cn(
          "h-12 w-12 rounded-2xl bg-control-bg/90 backdrop-blur-xl hover:bg-control-hover shadow-elevation border border-border/50 transition-all duration-300",
          isOpen && "bg-primary hover:bg-primary/90 text-white scale-110"
        )}
      >
        <Smile className="h-6 w-6" />
      </Button>

      {isOpen && (
        <div className="mt-2 bg-control-bg/90 backdrop-blur-xl rounded-2xl p-2 shadow-elevation border border-border/50 animate-fade-in">
          <div className="grid grid-cols-4 gap-1">
            {reactions.map((emoji) => (
              <Button
                key={emoji}
                onClick={() => handleReaction(emoji)}
                variant="ghost"
                size="icon"
                className="h-12 w-12 rounded-xl hover:bg-control-hover text-2xl"
              >
                {emoji}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ============= VideoTile Component =============
interface VideoTileProps {
  name: string;
  isMuted: boolean;
  isLocal?: boolean;
  isPinned?: boolean;
  isActiveSpeaker?: boolean;
  videoUrl?: string;
  onPin?: () => void;
}

const VideoTile = ({ name, isMuted, isLocal = false, isPinned = false, isActiveSpeaker = false, videoUrl }: VideoTileProps) => {
  const [showMenu, setShowMenu] = useState(false);
  
  const colors = [
    "from-primary to-accent",
    "from-success to-primary",
    "from-accent to-destructive",
    "from-warning to-success"
  ];
  const colorIndex = name.charCodeAt(0) % colors.length;

  return (
    <div className="relative w-full h-full bg-video-bg rounded-2xl overflow-hidden group transition-all duration-300 ease-out">
      {videoUrl ? (
        <video
          src={videoUrl}
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className={cn(
          "absolute inset-0 flex items-center justify-center bg-gradient-to-br transition-all duration-300",
          colors[colorIndex]
        )}>
          <div className="text-4xl md:text-6xl font-bold text-white opacity-90">
            {name.charAt(0).toUpperCase()}
          </div>
        </div>
      )}

      <div className="absolute top-0 left-0 right-0 p-3 bg-gradient-to-b from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-white text-sm font-medium truncate">{name}</span>
            {isLocal && (
              <span className="text-xs px-2 py-0.5 bg-primary/20 text-primary rounded-full">
                You
              </span>
            )}
          </div>
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
          >
            <MoreVertical className="w-4 h-4 text-white" />
          </button>
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/60 to-transparent">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={cn(
              "flex items-center justify-center w-8 h-8 rounded-full transition-all duration-300",
              isMuted ? "bg-destructive" : "bg-success"
            )}>
              {isMuted ? (
                <MicOff className="w-4 h-4 text-white" />
              ) : (
                <Mic className="w-4 h-4 text-white" />
              )}
            </div>
          </div>
          {isPinned && (
            <div className="flex items-center gap-1 px-2 py-1 bg-primary/20 rounded-full animate-scale-in">
              <Pin className="w-3 h-3 text-primary" />
              <span className="text-xs text-primary">Pinned</span>
            </div>
          )}
        </div>
      </div>

      <div className={cn(
        "absolute inset-0 border-[3px] rounded-2xl transition-all duration-300 pointer-events-none",
        isActiveSpeaker 
          ? "border-primary shadow-glow opacity-100 scale-[0.98]" 
          : "border-transparent opacity-0 scale-100"
      )} />
    </div>
  );
};

// ============= ParticipantGrid Component =============
interface ParticipantGridProps {
  participants: Participant[];
  currentPage: number;
  onPageChange: (page: number) => void;
}

const PARTICIPANTS_PER_PAGE = 8;

const ParticipantGrid = ({ participants, currentPage, onPageChange }: ParticipantGridProps) => {
  const totalPages = Math.ceil(participants.length / PARTICIPANTS_PER_PAGE);
  const startIdx = currentPage * PARTICIPANTS_PER_PAGE;
  const endIdx = Math.min(startIdx + PARTICIPANTS_PER_PAGE, participants.length);
  const visibleParticipants = participants.slice(startIdx, endIdx);
  const count = visibleParticipants.length;

  const getLayoutConfig = () => {
    switch (count) {
      case 1:
        return { 
          containerClass: "flex items-center justify-center p-4",
          itemClass: "w-full max-w-4xl h-full"
        };
      case 2:
        return { 
          containerClass: "flex flex-col gap-3 p-4",
          itemClass: "w-full flex-1"
        };
      case 3:
        return { 
          containerClass: "grid grid-cols-2 gap-3 p-4 auto-rows-fr",
          itemClass: "w-full h-full",
          lastFullWidth: true
        };
      case 4:
        return { 
          containerClass: "grid grid-cols-2 grid-rows-2 gap-3 p-4",
          itemClass: "w-full h-full"
        };
      case 5:
        return { 
          containerClass: "grid grid-cols-2 gap-3 p-4 auto-rows-fr",
          itemClass: "w-full h-full",
          lastFullWidth: true
        };
      case 6:
        return { 
          containerClass: "grid grid-cols-2 grid-rows-3 gap-3 p-4",
          itemClass: "w-full h-full"
        };
      case 7:
        return { 
          containerClass: "grid grid-cols-2 gap-3 p-4 auto-rows-fr",
          itemClass: "w-full h-full",
          lastFullWidth: true
        };
      case 8:
      default:
        return { 
          containerClass: "grid grid-cols-2 gap-3 p-4 auto-rows-fr",
          itemClass: "w-full h-full"
        };
    }
  };

  const config = getLayoutConfig();
  const shouldFullWidthLast = config.lastFullWidth && count % 2 !== 0;

  return (
    <div className="relative w-full h-full">
      <div className={cn(
        "w-full h-full overflow-hidden",
        config.containerClass
      )}>
        {visibleParticipants.map((participant, index) => {
          const isLast = index === count - 1;
          const shouldFullWidth = shouldFullWidthLast && isLast;
          
          return (
            <div 
              key={participant.id} 
              className={cn(
                config.itemClass,
                shouldFullWidth && "col-span-2 flex justify-center",
                "transition-all duration-500 ease-out animate-scale-in"
              )}
              style={{
                animationDelay: `${index * 50}ms`,
              }}
            >
              <div className={cn(
                "w-full h-full",
                shouldFullWidth && "max-w-[50%]"
              )}>
                <VideoTile
                  name={participant.name}
                  isMuted={participant.isMuted}
                  isLocal={participant.isLocal}
                  isPinned={participant.isPinned}
                  isActiveSpeaker={participant.isActiveSpeaker}
                  videoUrl={participant.videoUrl}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-control-bg/90 backdrop-blur-xl rounded-full px-4 py-2 shadow-elevation border border-border/50 animate-slide-up">
          <Button
            onClick={() => onPageChange(Math.max(0, currentPage - 1))}
            disabled={currentPage === 0}
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full disabled:opacity-30"
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-1">
            {Array.from({ length: totalPages }).map((_, idx) => (
              <button
                key={idx}
                onClick={() => onPageChange(idx)}
                className={cn(
                  "w-2 h-2 rounded-full transition-all duration-300",
                  currentPage === idx 
                    ? "bg-primary w-6" 
                    : "bg-muted-foreground/30 hover:bg-muted-foreground/50"
                )}
              />
            ))}
          </div>
          <Button
            onClick={() => onPageChange(Math.min(totalPages - 1, currentPage + 1))}
            disabled={currentPage === totalPages - 1}
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full disabled:opacity-30"
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
          <div className="ml-2 text-xs text-muted-foreground font-medium">
            {participants.length > PARTICIPANTS_PER_PAGE && `+${participants.length - PARTICIPANTS_PER_PAGE} more`}
          </div>
        </div>
      )}
    </div>
  );
};

// ============= VideoControls Component =============
interface VideoControlsProps {
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onEndCall: () => void;
  onToggleChat: () => void;
  onToggleParticipants: () => void;
  isMuted: boolean;
  isVideoOff: boolean;
  isChatOpen: boolean;
  isParticipantsOpen: boolean;
}

const VideoControls = ({
  onToggleMute,
  onToggleVideo,
  onEndCall,
  onToggleChat,
  onToggleParticipants,
  isMuted,
  isVideoOff,
  isChatOpen,
  isParticipantsOpen,
}: VideoControlsProps) => {
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [showMore, setShowMore] = useState(false);

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[90%] max-w-md animate-slide-up">
      <div className="bg-control-bg/90 backdrop-blur-xl rounded-3xl p-4 shadow-elevation border border-border/50">
        <div className="flex items-center justify-between gap-3">
          <Button
            onClick={onToggleMute}
            variant="ghost"
            size="icon"
            className={cn(
              "h-14 w-14 rounded-2xl transition-all duration-300",
              isMuted 
                ? "bg-destructive hover:bg-destructive/90 text-white scale-105" 
                : "bg-secondary hover:bg-control-hover text-foreground"
            )}
          >
            {isMuted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
          </Button>

          <Button
            onClick={onToggleVideo}
            variant="ghost"
            size="icon"
            className={cn(
              "h-14 w-14 rounded-2xl transition-all duration-300",
              isVideoOff 
                ? "bg-destructive hover:bg-destructive/90 text-white scale-105" 
                : "bg-secondary hover:bg-control-hover text-foreground"
            )}
          >
            {isVideoOff ? <VideoOff className="h-6 w-6" /> : <Video className="h-6 w-6" />}
          </Button>

          <Button
            onClick={onEndCall}
            variant="ghost"
            size="icon"
            className="h-14 w-14 rounded-2xl bg-destructive hover:bg-destructive/90 text-white transition-all duration-300 hover:scale-105"
          >
            <PhoneOff className="h-6 w-6" />
          </Button>

          <Button
            onClick={() => setIsSpeakerOn(!isSpeakerOn)}
            variant="ghost"
            size="icon"
            className="h-14 w-14 rounded-2xl bg-secondary hover:bg-control-hover text-foreground transition-all duration-300"
          >
            {isSpeakerOn ? <Volume2 className="h-6 w-6" /> : <VolumeX className="h-6 w-6" />}
          </Button>

          <Button
            onClick={() => setShowMore(!showMore)}
            variant="ghost"
            size="icon"
            className={cn(
              "h-14 w-14 rounded-2xl transition-all duration-300",
              showMore 
                ? "bg-primary text-white" 
                : "bg-secondary hover:bg-control-hover text-foreground"
            )}
          >
            <MoreVertical className="h-6 w-6" />
          </Button>
        </div>

        {showMore && (
          <div className="mt-3 pt-3 border-t border-border flex items-center justify-around animate-fade-in">
            <Button
              onClick={() => setIsScreenSharing(!isScreenSharing)}
              variant="ghost"
              size="icon"
              className={cn(
                "h-12 w-12 rounded-xl transition-all duration-300",
                isScreenSharing 
                  ? "bg-primary text-white" 
                  : "bg-secondary hover:bg-control-hover text-foreground"
              )}
            >
              <MonitorUp className="h-5 w-5" />
            </Button>

            <Button
              onClick={onToggleChat}
              variant="ghost"
              size="icon"
              className={cn(
                "h-12 w-12 rounded-xl transition-all duration-300",
                isChatOpen 
                  ? "bg-primary text-white" 
                  : "bg-secondary hover:bg-control-hover text-foreground"
              )}
            >
              <MessageSquare className="h-5 w-5" />
            </Button>

            <Button
              onClick={onToggleParticipants}
              variant="ghost"
              size="icon"
              className={cn(
                "h-12 w-12 rounded-xl transition-all duration-300",
                isParticipantsOpen 
                  ? "bg-primary text-white" 
                  : "bg-secondary hover:bg-control-hover text-foreground"
              )}
            >
              <Users className="h-5 w-5" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="h-12 w-12 rounded-xl bg-secondary hover:bg-control-hover text-foreground transition-all duration-300"
            >
              <SwitchCamera className="h-5 w-5" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="h-12 w-12 rounded-xl bg-secondary hover:bg-control-hover text-foreground transition-all duration-300"
            >
              <Settings className="h-5 w-5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

// ============= ChatPanel Component =============
interface ChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const ChatPanel = ({ isOpen, onClose }: ChatPanelProps) => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      sender: "Alice Cooper",
      text: "Hey everyone! Can you all hear me?",
      time: "10:30",
      isLocal: false,
    },
    {
      id: "2",
      sender: "You",
      text: "Yes, loud and clear!",
      time: "10:31",
      isLocal: true,
    },
  ]);
  const [newMessage, setNewMessage] = useState("");

  const handleSend = () => {
    if (newMessage.trim()) {
      const message: Message = {
        id: Date.now().toString(),
        sender: "You",
        text: newMessage,
        time: new Date().toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        isLocal: true,
      };
      setMessages([...messages, message]);
      setNewMessage("");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed right-0 top-0 bottom-0 w-full max-w-sm bg-card border-l border-border z-40 animate-fade-in flex flex-col">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <h2 className="text-lg font-semibold text-foreground">Chat</h2>
        <Button
          onClick={onClose}
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-lg transition-all duration-300 hover:rotate-90"
        >
          <X className="h-5 w-5" />
        </Button>
      </div>

      <ScrollArea className="flex-1 p-4">
        <div className="space-y-4">
          {messages.map((message, idx) => (
            <div
              key={message.id}
              className={`flex flex-col animate-fade-in ${message.isLocal ? "items-end" : "items-start"}`}
              style={{ animationDelay: `${idx * 50}ms` }}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2 transition-all duration-300 ${
                  message.isLocal
                    ? "bg-primary text-white"
                    : "bg-secondary text-foreground"
                }`}
              >
                {!message.isLocal && (
                  <p className="text-xs font-medium mb-1 opacity-70">
                    {message.sender}
                  </p>
                )}
                <p className="text-sm">{message.text}</p>
              </div>
              <span className="text-xs text-muted-foreground mt-1">
                {message.time}
              </span>
            </div>
          ))}
        </div>
      </ScrollArea>

      <div className="p-4 border-t border-border">
        <div className="flex gap-2">
          <Input
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyPress={(e) => e.key === "Enter" && handleSend()}
            placeholder="Type a message..."
            className="flex-1 bg-secondary border-border rounded-xl transition-all duration-300 focus:scale-[1.02]"
          />
          <Button
            onClick={handleSend}
            size="icon"
            className="h-10 w-10 rounded-xl bg-primary hover:bg-primary/90 transition-all duration-300 hover:scale-105"
          >
            <Send className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </div>
  );
};

// ============= ParticipantsPanel Component =============
interface ParticipantsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  participants: Participant[];
}

const ParticipantsPanel = ({ isOpen, onClose, participants }: ParticipantsPanelProps) => {
  if (!isOpen) return null;

  return (
    <div className="fixed right-0 top-0 bottom-0 w-full max-w-sm bg-card border-l border-border z-40 animate-fade-in flex flex-col">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Participants</h2>
          <p className="text-sm text-muted-foreground">{participants.length} in call</p>
        </div>
        <Button
          onClick={onClose}
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-lg transition-all duration-300 hover:rotate-90"
        >
          <X className="h-5 w-5" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-2">
          {participants.map((participant, idx) => (
            <div
              key={participant.id}
              className="flex items-center justify-between p-3 rounded-xl bg-secondary/50 hover:bg-secondary transition-all duration-300 group animate-fade-in hover:scale-[1.02]"
              style={{ animationDelay: `${idx * 30}ms` }}
            >
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white font-semibold transition-transform duration-300 group-hover:scale-110">
                    {participant.name.charAt(0).toUpperCase()}
                  </div>
                  {participant.isHost && (
                    <div className="absolute -top-1 -right-1 w-5 h-5 bg-warning rounded-full flex items-center justify-center animate-scale-in">
                      <Crown className="w-3 h-3 text-white" />
                    </div>
                  )}
                </div>
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">
                      {participant.name}
                    </span>
                    {participant.isLocal && (
                      <span className="text-xs px-2 py-0.5 bg-primary/20 text-primary rounded-full">
                        You
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={cn(
                      "text-xs",
                      participant.isMuted ? "text-destructive" : "text-success"
                    )}>
                      {participant.isMuted ? "Muted" : "Unmuted"}
                    </span>
                    {participant.isVideoOff && (
                      <span className="text-xs text-muted-foreground">• Video off</span>
                    )}
                  </div>
                </div>
              </div>
              
              <div className="flex items-center gap-1">
                {participant.isMuted ? (
                  <div className="p-2 rounded-lg bg-destructive/10 transition-all duration-300">
                    <MicOff className="w-4 h-4 text-destructive" />
                  </div>
                ) : (
                  <div className="p-2 rounded-lg bg-success/10 transition-all duration-300">
                    <Mic className="w-4 h-4 text-success" />
                  </div>
                )}
                {participant.isVideoOff && (
                  <div className="p-2 rounded-lg bg-muted transition-all duration-300">
                    <VideoOff className="w-4 h-4 text-muted-foreground" />
                  </div>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-lg opacity-0 group-hover:opacity-100 transition-all duration-300"
                >
                  <MoreVertical className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
};

// ============= Main Index Page =============
const Index = () => {
  const { toast } = useToast();
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isParticipantsOpen, setIsParticipantsOpen] = useState(false);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [activeSpeakerId, setActiveSpeakerId] = useState<string>("2");
  const [currentPage, setCurrentPage] = useState(0);

  // Generate more participants with video URLs
  const generateParticipants = (count: number): Participant[] => {
    const names = [
      "You", "Alice Cooper", "Bob Smith", "Charlie Davis", "Diana Prince", 
      "Eve Wilson", "Frank Miller", "Grace Lee", "Henry Ford", "Iris West",
      "Jack Ryan", "Kate Bishop", "Liam Chen", "Maya Singh", "Noah Kim",
      "Olivia Brown", "Peter Parker", "Quinn Taylor", "Rachel Green", "Sam Wilson"
    ];
    
    return Array.from({ length: count }, (_, i) => ({
      id: String(i + 1),
      name: names[i] || `Participant ${i + 1}`,
      isMuted: Math.random() > 0.5,
      isVideoOff: i === 0 ? false : Math.random() > 0.7,
      isLocal: i === 0,
      isHost: i === 0,
      videoUrl: SAMPLE_VIDEOS[i % SAMPLE_VIDEOS.length],
    }));
  };
  
  const [participantCount, setParticipantCount] = useState(12);
  const allParticipants = generateParticipants(participantCount);

  // Simulate active speaker changes
  useEffect(() => {
    const interval = setInterval(() => {
      const randomIndex = Math.floor(Math.random() * allParticipants.length);
      setActiveSpeakerId(allParticipants[randomIndex].id);
    }, 3000);
    return () => clearInterval(interval);
  }, [allParticipants]);

  const handleToggleMute = () => {
    setIsMuted(!isMuted);
    toast({
      description: isMuted ? "Microphone unmuted" : "Microphone muted",
      duration: 2000,
    });
  };

  const handleToggleVideo = () => {
    setIsVideoOff(!isVideoOff);
    toast({
      description: isVideoOff ? "Camera turned on" : "Camera turned off",
      duration: 2000,
    });
  };

  const handleEndCall = () => {
    toast({
      title: "Call ended",
      description: "You have left the meeting",
      variant: "destructive",
    });
  };

  const handleReaction = (emoji: string) => {
    const newReaction: Reaction = {
      id: Date.now().toString(),
      emoji,
    };
    setReactions([...reactions, newReaction]);
  };

  const handleReactionComplete = (id: string) => {
    setReactions(reactions.filter(r => r.id !== id));
  };

  return (
    <div className="relative min-h-screen bg-background overflow-hidden">
      {/* Meeting info header */}
      <div className="absolute top-0 left-0 right-0 z-30 p-4 bg-gradient-to-b from-black/40 to-transparent">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-white text-lg font-semibold">Team Meeting</h1>
            <p className="text-white/70 text-sm">10:30 AM • {participantCount} participant{participantCount !== 1 ? 's' : ''}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-black/30 backdrop-blur-sm rounded-full p-1">
              <button
                onClick={() => {
                  setParticipantCount(Math.max(1, participantCount - 1));
                  setCurrentPage(0);
                }}
                disabled={participantCount <= 1}
                className="w-8 h-8 flex items-center justify-center text-white hover:bg-white/20 rounded-full transition-all duration-300 disabled:opacity-30 disabled:hover:bg-transparent"
              >
                -
              </button>
              <span className="text-white text-sm font-medium px-2">{participantCount}</span>
              <button
                onClick={() => {
                  setParticipantCount(Math.min(20, participantCount + 1));
                }}
                disabled={participantCount >= 20}
                className="w-8 h-8 flex items-center justify-center text-white hover:bg-white/20 rounded-full transition-all duration-300 disabled:opacity-30 disabled:hover:bg-transparent"
              >
                +
              </button>
            </div>
            <div className="px-3 py-1.5 bg-success/20 rounded-full">
              <span className="text-success text-sm font-medium">45:23</span>
            </div>
          </div>
        </div>
      </div>

      {/* Participant Grid */}
      <div className="h-screen pt-20 pb-32">
        <ParticipantGrid 
          participants={allParticipants.map(p => ({
            ...p,
            isActiveSpeaker: p.id === activeSpeakerId,
          }))}
          currentPage={currentPage}
          onPageChange={setCurrentPage}
        />
      </div>

      {/* Video Controls */}
      <VideoControls
        onToggleMute={handleToggleMute}
        onToggleVideo={handleToggleVideo}
        onEndCall={handleEndCall}
        onToggleChat={() => setIsChatOpen(!isChatOpen)}
        onToggleParticipants={() => setIsParticipantsOpen(!isParticipantsOpen)}
        isMuted={isMuted}
        isVideoOff={isVideoOff}
        isChatOpen={isChatOpen}
        isParticipantsOpen={isParticipantsOpen}
      />

      {/* Chat Panel */}
      <ChatPanel isOpen={isChatOpen} onClose={() => setIsChatOpen(false)} />

      {/* Participants Panel */}
      <ParticipantsPanel
        isOpen={isParticipantsOpen}
        onClose={() => setIsParticipantsOpen(false)}
        participants={allParticipants.map(p => ({
          ...p,
          isMuted: p.isMuted || (p.isLocal && isMuted),
          isVideoOff: p.isVideoOff || (p.isLocal && isVideoOff),
        }))}
      />

      {/* Reaction Bar */}
      <ReactionBar onReaction={handleReaction} />

      {/* Draggable Self View */}
      <DraggableSelfView
        name={allParticipants[0]?.name || "You"}
        isMuted={isMuted}
        isVideoOff={isVideoOff}
      />

      {/* Floating Reactions */}
      {reactions.map((reaction) => (
        <FloatingReaction
          key={reaction.id}
          emoji={reaction.emoji}
          id={reaction.id}
          onComplete={handleReactionComplete}
        />
      ))}
    </div>
  );
};

export default Index;
