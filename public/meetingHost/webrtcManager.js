class EnhancedWebRTCManager {
  constructor(socket) {
    this.socket = socket;
    this.localStream = null;
    this.peerConnections = new Map();
    this.remoteStreams = new Map();
    this.screenStream = null;
    this.isScreenSharing = false;
    this.pendingCandidates = new Map();
    this.makingOffer = new Map();
    this.ignoreOffer = new Map();
    this.isSettingRemoteDescription = new Map();

    this.configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ],
      iceCandidatePoolSize: 10,
      iceTransportPolicy: 'all',
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    };

    this.setupSocketListeners();
  }

  async initialize() {
    try {
      const response = await fetch('/api/ice-servers');
      const { webrtcConfig } = await response.json();
      if (webrtcConfig) {
        this.configuration = webrtcConfig;
        console.log('Applied enhanced ICE configuration from server', this.configuration);
      }

      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      console.log('Local stream initialized with enhanced config');
      return true;
    } catch (error) {
      console.error('Error initializing WebRTC:', error);
      return false;
    }
  }

  setupSocketListeners() {
    this.socket.on('offer', async (data) => {
      await this.handleOfferWithPerfectNegotiation(data);
    });

    this.socket.on('answer', async (data) => {
      await this.handleAnswerWithPerfectNegotiation(data);
    });

    this.socket.on('ice-candidate', async (data) => {
      await this.handleIceCandidateWithBuffering(data);
    });

    this.socket.on('retry-connection', async (data) => {
      await this.handleConnectionRetry(data);
    });

    this.socket.on('restart-connection', async (data) => {
      await this.restartConnection(data);
    });

    this.socket.on('initiate-connection', async (data) => {
      await this.createPeerConnection(data.targetSocketId, data.shouldCreateOffer, data.webrtcConfig);
    });
  }

  async startScreenShare() {
    try {
      console.log('Starting screen share...');

      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always', displaySurface: 'monitor' },
        audio: true
      });

      console.log('Screen stream acquired:', this.screenStream.getTracks());
      this.isScreenSharing = true;

      const screenVideoTrack = this.screenStream.getVideoTracks()[0];
      const screenAudioTrack = this.screenStream.getAudioTracks()[0];

      if (screenVideoTrack) {
        screenVideoTrack.onended = () => {
          console.log('Screen share ended by user');
          this.stopScreenShare();

          const screenShareBtn = document.getElementById('screenShareBtn');
          if (screenShareBtn) {
            screenShareBtn.setAttribute('data-active', 'false');
            const icon = screenShareBtn.querySelector('i');
            if (icon) {
              icon.className = 'fas fa-desktop';
            }
          }

          this.socket.emit('stop-screen-share');
        };

        this.peerConnections.forEach(async (pc, socketId) => {
          try {
            const senders = pc.getSenders();
            const videoSender = senders.find(sender =>
              sender.track && sender.track.kind === 'video' &&
              sender.track !== screenVideoTrack
            );

            if (videoSender) {
              await videoSender.replaceTrack(screenVideoTrack);
              console.log(`Replaced camera track with screen share for ${socketId}`);
            } else {
              pc.addTrack(screenVideoTrack, this.screenStream);
              console.log(`Added screen share track for ${socketId}`);
            }
          } catch (error) {
            console.error(`Error replacing/adding screen share track for ${socketId}:`, error);
          }
        });
      }

      if (screenAudioTrack) {
        this.peerConnections.forEach(async (pc, socketId) => {
          try {
            pc.addTrack(screenAudioTrack, this.screenStream);
            console.log(`Added computer audio track for ${socketId}`);
          } catch (error) {
            console.error(`Error adding audio track for ${socketId}:`, error);
          }
        });
      }

      this.updateLocalVideoDisplay();
      return true;
    } catch (error) {
      console.error('Failed to start screen share:', error);
      this.isScreenSharing = false;
      throw error;
    }
  }

  async stopScreenShare() {
    try {
      console.log('Stopping screen share...');

      if (!this.screenStream) {
        console.log('No screen stream to stop');
        return;
      }

      this.screenStream.getTracks().forEach(track => {
        track.stop();
        console.log(`Stopped ${track.kind} track`);
      });

      this.peerConnections.forEach(async (pc, socketId) => {
        try {
          const senders = pc.getSenders();

          const screenVideoSender = senders.find(sender =>
            sender.track &&
            sender.track.kind === 'video' &&
            this.screenStream.getVideoTracks().includes(sender.track)
          );

          if (screenVideoSender && this.localStream) {
            const cameraVideoTrack = this.localStream.getVideoTracks()[0];
            if (cameraVideoTrack) {
              await screenVideoSender.replaceTrack(cameraVideoTrack);
              console.log(`Replaced screen share with camera track for ${socketId}`);
            }
          }

          const screenAudioSenders = senders.filter(sender =>
            sender.track &&
            sender.track.kind === 'audio' &&
            this.screenStream.getAudioTracks().includes(sender.track)
          );

          screenAudioSenders.forEach(sender => {
            pc.removeTrack(sender);
            console.log(`Removed computer audio track for ${socketId}`);
          });
        } catch (error) {
          console.error(`Error replacing screen share for ${socketId}:`, error);
        }
      });

      this.screenStream = null;
      this.isScreenSharing = false;

      this.updateLocalVideoDisplay();

      console.log('Screen share stopped successfully');
    } catch (error) {
      console.error('Error stopping screen share:', error);
    }
  }

  updateLocalVideoDisplay() {
    const localVideo = document.querySelector(`[data-socket-id="${this.socket.id}"] .video-frame`);
    if (localVideo) {
      if (this.isScreenSharing && this.screenStream) {
        localVideo.srcObject = this.screenStream;
      } else if (this.localStream) {
        localVideo.srcObject = this.localStream;
      }
      localVideo.play().catch(e => console.error('Error playing local video:', e));
    }
  }

  async createPeerConnection(remoteSocketId, shouldCreateOffer, serverConfig = null) {
    try {
      console.log(`Creating peer connection with ${remoteSocketId}, shouldCreateOffer: ${shouldCreateOffer}`);

      if (this.peerConnections.has(remoteSocketId)) {
        this.peerConnections.get(remoteSocketId).close();
        this.peerConnections.delete(remoteSocketId);
      }

      const config = serverConfig || this.configuration;
      const peerConnection = new RTCPeerConnection(config);
      this.peerConnections.set(remoteSocketId, peerConnection);

      this.makingOffer.set(remoteSocketId, false);
      this.ignoreOffer.set(remoteSocketId, false);
      this.isSettingRemoteDescription.set(remoteSocketId, false);
      this.pendingCandidates.set(remoteSocketId, []);

      if (this.localStream) {
        this.localStream.getTracks().forEach(track => {
          if (track.kind === 'video' && this.isScreenSharing) {
            return;
          }

          peerConnection.addTrack(track, this.localStream);
          console.log(`Added ${track.kind} track to peer connection`);
        });
      }

      if (this.isScreenSharing && this.screenStream) {
        const screenVideoTrack = this.screenStream.getVideoTracks()[0];
        if (screenVideoTrack) {
          peerConnection.addTrack(screenVideoTrack, this.screenStream);
          console.log('Added screen share to new peer connection');
        }

        const screenAudioTrack = this.screenStream.getAudioTracks()[0];
        if (screenAudioTrack) {
          peerConnection.addTrack(screenAudioTrack, this.screenStream);
          console.log('Added computer audio to new peer connection');
        }
      }

      peerConnection.onicecandidate = ({ candidate }) => {
        if (candidate) {
          console.log(`Sending ICE candidate (${candidate.type || 'unknown'}) to ${remoteSocketId}`);
          this.socket.emit('ice-candidate', {
            target: remoteSocketId,
            candidate: candidate.toJSON(),
            connectionId: `${this.socket.id}-${remoteSocketId}`
          });
        } else {
          console.log(`ICE gathering complete for ${remoteSocketId}`);
        }
      };

      peerConnection.onicegatheringstatechange = () => {
        console.log(`ICE gathering state for ${remoteSocketId}: ${peerConnection.iceGatheringState}`);
      };

      peerConnection.onconnectionstatechange = async () => {
        const state = peerConnection.connectionState;
        console.log(`Connection state with ${remoteSocketId}: ${state}`);

        this.socket.emit('connection-state-change', {
          targetSocketId: remoteSocketId,
          state: state,
          connectionId: `${this.socket.id}-${remoteSocketId}`
        });

        if (state === 'failed') {
          console.warn(`Connection failed with ${remoteSocketId}, initiating ICE restart`);
          await this.performIceRestart(remoteSocketId);
        } else if (state === 'disconnected') {
          console.warn(`Connection disconnected with ${remoteSocketId}, waiting before restart...`);
          setTimeout(async () => {
            if (peerConnection.connectionState === 'disconnected') {
              await this.performIceRestart(remoteSocketId);
            }
          }, 3000);
        } else if (state === 'connected') {
          console.log(`Successfully connected to ${remoteSocketId}`);
          await this.processBufferedCandidates(remoteSocketId);
        }
      };

      peerConnection.oniceconnectionstatechange = () => {
        console.log(`ICE connection state with ${remoteSocketId}: ${peerConnection.iceConnectionState}`);

        if (peerConnection.iceConnectionState === 'failed') {
          console.error(`ICE connection failed with ${remoteSocketId}`);
          this.socket.emit('connection-failed', {
            targetSocketId: remoteSocketId,
            reason: 'ice-failed',
            connectionId: `${this.socket.id}-${remoteSocketId}`
          });
        }
      };

      peerConnection.ontrack = (event) => {
        console.log(`Received ${event.track.kind} track from ${remoteSocketId}`);
        const [remoteStream] = event.streams;
        this.remoteStreams.set(remoteSocketId, remoteStream);
        this.updateRemoteVideo(remoteSocketId, remoteStream);

        event.track.onended = () => {
          console.log(`Track ended from ${remoteSocketId}: ${event.track.kind}`);
        };

        event.track.onmute = () => {
          console.log(`Track muted from ${remoteSocketId}: ${event.track.kind}`);
        };

        event.track.onunmute = () => {
          console.log(`Track unmuted from ${remoteSocketId}: ${event.track.kind}`);
        };
      };

      peerConnection.onnegotiationneeded = async () => {
        try {
          console.log(`Negotiation needed with ${remoteSocketId}`);
          this.makingOffer.set(remoteSocketId, true);

          await peerConnection.setLocalDescription();

          this.socket.emit('offer', {
            target: remoteSocketId,
            offer: peerConnection.localDescription.toJSON(),
            connectionId: `${this.socket.id}-${remoteSocketId}`
          });

          console.log(`Sent offer to ${remoteSocketId}`);
        } catch (error) {
          console.error(`Error in negotiationneeded for ${remoteSocketId}:`, error);
        } finally {
          this.makingOffer.set(remoteSocketId, false);
        }
      };

      if (shouldCreateOffer) {
        try {
          console.log(`Creating initial offer for ${remoteSocketId}`);
          this.makingOffer.set(remoteSocketId, true);

          const offer = await peerConnection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true,
            iceRestart: false
          });

          await peerConnection.setLocalDescription(offer);

          this.socket.emit('offer', {
            target: remoteSocketId,
            offer: peerConnection.localDescription.toJSON(),
            connectionId: `${this.socket.id}-${remoteSocketId}`
          });

          console.log(`Initial offer sent to ${remoteSocketId}`);
        } catch (error) {
          console.error(`Error creating initial offer for ${remoteSocketId}:`, error);
        } finally {
          this.makingOffer.set(remoteSocketId, false);
        }
      }

    } catch (error) {
      console.error('Error creating peer connection:', error);
    }
  }

  async handleOfferWithPerfectNegotiation(data) {
    const { offer, sender } = data;
    console.log(`Handling offer from ${sender}`);

    try {
      let peerConnection = this.peerConnections.get(sender);

      if (!peerConnection) {
        await this.createPeerConnection(sender, false);
        peerConnection = this.peerConnections.get(sender);
      }

      const offerCollision = offer.type === 'offer' &&
        (this.makingOffer.get(sender) || peerConnection.signalingState !== 'stable');

      this.ignoreOffer.set(sender, offerCollision && this.isPolite(sender));

      if (this.ignoreOffer.get(sender)) {
        console.log(`Ignoring offer from ${sender} due to collision (polite party)`);
        return;
      }

      this.isSettingRemoteDescription.set(sender, true);
      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      this.isSettingRemoteDescription.set(sender, false);

      await this.processBufferedCandidates(sender);

      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      this.socket.emit('answer', {
        target: sender,
        answer: peerConnection.localDescription.toJSON(),
        connectionId: `${this.socket.id}-${sender}`
      });

      console.log(`Sent answer to ${sender}`);
    } catch (error) {
      console.error(`Error handling offer from ${sender}:`, error);
      this.isSettingRemoteDescription.set(sender, false);
    }
  }

  async handleAnswerWithPerfectNegotiation(data) {
    const { answer, sender } = data;
    console.log(`Handling answer from ${sender}`);

    try {
      const peerConnection = this.peerConnections.get(sender);

      if (!peerConnection) {
        console.warn(`No peer connection found for answer from ${sender}`);
        return;
      }

      this.isSettingRemoteDescription.set(sender, true);
      await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      this.isSettingRemoteDescription.set(sender, false);

      await this.processBufferedCandidates(sender);

      console.log(`Answer from ${sender} applied successfully`);
    } catch (error) {
      console.error(`Error handling answer from ${sender}:`, error);
      this.isSettingRemoteDescription.set(sender, false);
    }
  }

  async handleIceCandidateWithBuffering(data) {
    const { candidate, sender } = data;
    const peerConnection = this.peerConnections.get(sender);

    if (!peerConnection) {
      console.warn(`No peer connection for ICE candidate from ${sender}, ignoring`);
      return;
    }

    try {
      if (peerConnection.remoteDescription && !this.isSettingRemoteDescription.get(sender)) {
        if (candidate && candidate.candidate) {
          await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
          console.log(`Added ICE candidate from ${sender}`);
        }
      } else {
        if (!this.pendingCandidates.has(sender)) {
          this.pendingCandidates.set(sender, []);
        }
        this.pendingCandidates.get(sender).push(candidate);
        console.log(`Buffered ICE candidate from ${sender} (total buffered: ${this.pendingCandidates.get(sender).length})`);
      }
    } catch (error) {
      console.error(`Error handling ICE candidate from ${sender}:`, error);
    }
  }

  async processBufferedCandidates(remoteSocketId) {
    const candidates = this.pendingCandidates.get(remoteSocketId);
    if (!candidates || candidates.length === 0) {
      return;
    }

    console.log(`Processing ${candidates.length} buffered ICE candidates for ${remoteSocketId}`);
    const peerConnection = this.peerConnections.get(remoteSocketId);

    if (!peerConnection || !peerConnection.remoteDescription) {
      console.warn(`Cannot process buffered candidates for ${remoteSocketId}: not ready`);
      return;
    }

    const processed = [];
    for (const candidate of candidates) {
      try {
        if (candidate && candidate.candidate) {
          await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
          processed.push(candidate);
        }
      } catch (error) {
        console.error(`Error adding buffered candidate for ${remoteSocketId}:`, error);
      }
    }

    this.pendingCandidates.set(
      remoteSocketId,
      candidates.filter(c => !processed.includes(c))
    );

    console.log(`Processed ${processed.length} buffered candidates for ${remoteSocketId}`);
  }

  async performIceRestart(remoteSocketId) {
    console.log(`Performing ICE restart for ${remoteSocketId}`);
    const peerConnection = this.peerConnections.get(remoteSocketId);

    if (!peerConnection) {
      console.warn(`No peer connection to restart for ${remoteSocketId}`);
      return;
    }

    try {
      this.makingOffer.set(remoteSocketId, true);

      const offer = await peerConnection.createOffer({ iceRestart: true });
      await peerConnection.setLocalDescription(offer);

      this.socket.emit('offer', {
        target: remoteSocketId,
        offer: peerConnection.localDescription.toJSON(),
        connectionId: `ice-restart-${this.socket.id}-${remoteSocketId}`,
        iceRestart: true
      });

      console.log(`ICE restart offer sent to ${remoteSocketId}`);
    } catch (error) {
      console.error(`Error during ICE restart for ${remoteSocketId}:`, error);
    } finally {
      this.makingOffer.set(remoteSocketId, false);
    }
  }

  async handleConnectionRetry(data) {
    const { targetSocketId, attempt } = data;
    console.log(`Retry connection request for ${targetSocketId}, attempt ${attempt}`);

    await new Promise(resolve => setTimeout(resolve, 1000));
    await this.createPeerConnection(targetSocketId, true);
  }

  async restartConnection(data) {
    const { targetSocketId, webrtcConfig } = data;
    console.log(`Restarting connection with ${targetSocketId}`);

    const oldConnection = this.peerConnections.get(targetSocketId);
    if (oldConnection) {
      oldConnection.close();
    }

    this.peerConnections.delete(targetSocketId);
    this.pendingCandidates.delete(targetSocketId);

    await this.createPeerConnection(targetSocketId, true, webrtcConfig);
  }

  isPolite(remoteSocketId) {
    return this.socket.id < remoteSocketId;
  }

  updateRemoteVideo(socketId, stream) {
    setTimeout(() => {
      const videoWrapper = document.querySelector(`[data-socket-id="${socketId}"]`);
      if (videoWrapper) {
        const video = videoWrapper.querySelector('.video-frame');
        if (video && video.srcObject !== stream) {
          video.srcObject = stream;
          video.play().catch(e => console.error('Error playing video:', e));
          console.log(`Video attached and playing for ${socketId}`);
        }
      }
    }, 100);
  }

  setReady() {
    this.socket.emit('participant-ready');
  }

  getRemoteStream(socketId) {
    return this.remoteStreams.get(socketId);
  }

  removePeerConnection(socketId) {
    const peerConnection = this.peerConnections.get(socketId);
    if (peerConnection) {
      peerConnection.close();
      this.peerConnections.delete(socketId);
    }
    this.remoteStreams.delete(socketId);
    this.pendingCandidates.delete(socketId);
    this.makingOffer.delete(socketId);
    this.ignoreOffer.delete(socketId);
    this.isSettingRemoteDescription.delete(socketId);
  }

  async toggleAudio(enabled) {
    if (this.localStream) {
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = enabled;
      }
    }
  }

  async toggleVideo(enabled) {
    if (this.localStream) {
      const videoTrack = this.localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = enabled;
      }
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = EnhancedWebRTCManager;
}
