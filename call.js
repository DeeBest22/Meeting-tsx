import { Server as SocketIO } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { authenticateUser } from './auth.js';
import { recordMeetingStart, recordMeetingEnd } from './meetingStats.js';
import { recordMeetingParticipant } from './meetingParticipantStats.js';
import { setupHandRaising } from './handRaising.js';
import { setupPoll } from './poll.js';
import { Meeting, meetings, participants, validateData } from './meetingManager.js';
import { setupConnectionHandlers } from './connectionManager.js';
import { setupParticipantHandlers } from './participantManager.js';
import { setupMediaHandlers } from './mediaManager.js';

// Fix for __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const setupSocketIO = (server, app) => {
  const io = new SocketIO(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
      credentials: true
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 120000,
    pingInterval: 25000,
    upgradeTimeout: 30000,
    allowEIO3: true,
    maxHttpBufferSize: 1e8, // 100MB for large data transfers
    allowRequest: (req, callback) => {
      callback(null, true);
    }
  });

  const pollSystem = setupPoll(app, io);
  const { setupPollSocketHandlers } = pollSystem;

  // Connection health monitoring
  setInterval(() => {
    meetings.forEach((meeting, meetingId) => {
      const unhealthy = [];
      const now = new Date();
      
      meeting.participants.forEach((participant, socketId) => {
        const timeSinceHeartbeat = now - participant.lastHeartbeat;
        if (timeSinceHeartbeat > 60000) { // 1 minute without heartbeat
          unhealthy.push(socketId);
        }
      });
      
      if (unhealthy.length > 0) {
        console.log(`Meeting ${meetingId}: Found ${unhealthy.length} unhealthy connections`);
        unhealthy.forEach(socketId => {
          io.to(socketId).emit('connection-health-check');
        });
      }
    });
  }, 30000); // Check every 30 seconds

  // Meeting routes
  const setupMeetingRoutes = (app) => {
    app.get('/host/:meetingId', authenticateUser, (req, res) => {
      res.sendFile(path.join(__dirname, '../public', 'meetingHost.html'));
    });

    app.get('/join/:meetingId', authenticateUser, (req, res) => {
      const { meetingId } = req.params;
      const meeting = meetings.get(meetingId);
      
      if (meeting && meeting.isLocked) {
        res.sendFile(path.join(__dirname, '../public', 'meetingLocked.html'));
        return;
      }
      
      res.sendFile(path.join(__dirname, '../public', 'meetingJoin.html'));
    });

    app.post('/api/create-meeting', authenticateUser, (req, res) => {
      const meetingId = uuidv4().substring(0, 8).toUpperCase();
      
      res.json({ 
        meetingId,
        hostUrl: `/host/${meetingId}`,
        joinUrl: `/join/${meetingId}`
      });
    });

    app.get('/api/meeting/:meetingId', authenticateUser, (req, res) => {
      const { meetingId } = req.params;
      const meeting = meetings.get(meetingId);
      
      if (!meeting) {
        return res.status(404).json({ error: 'Meeting not found' });
      }

      res.json({
        id: meeting.id,
        hostName: meeting.hostName,
        meetingName: meeting.meetingName,
        participantCount: meeting.participants.size,
        createdAt: meeting.createdAt,
        isLocked: meeting.isLocked,
        permissions: meeting.getPermissions()
      });
    });

    app.get('/api/ice-servers', authenticateUser, (req, res) => {
      const meeting = new Meeting('temp', 'temp', 'temp');
      res.json({ 
        iceServers: meeting.iceServers,
        webrtcConfig: meeting.getWebRTCConfig()
      });
    });

    app.get('/api/network-test', authenticateUser, (req, res) => {
      res.json({
        timestamp: new Date().toISOString(),
        server: req.headers.host,
        userAgent: req.headers['user-agent'],
        ip: req.ip || req.connection.remoteAddress,
        status: 'ok'
      });
    });

    app.get('/api/meeting/:meetingId/diagnostics', authenticateUser, (req, res) => {
      const { meetingId } = req.params;
      const meeting = meetings.get(meetingId);

      if (!meeting) {
        return res.status(404).json({ error: 'Meeting not found' });
      }

      const diagnostics = {
        meetingId: meeting.id,
        participantCount: meeting.participants.size,
        participants: Array.from(meeting.participants.values()).map(p => ({
          socketId: p.socketId,
          name: p.name,
          isReady: p.isReady,
          connectionState: p.connectionState,
          networkQuality: p.networkQuality,
          lastHeartbeat: p.lastHeartbeat,
          timeSinceHeartbeat: Date.now() - p.lastHeartbeat.getTime()
        })),
        connectionAttempts: Array.from(meeting.connectionAttempts.entries()),
        unhealthyConnections: [],
        iceServers: meeting.iceServers.map(server => ({
          urls: server.urls,
          hasCredentials: !!(server.username && server.credential)
        })),
        webrtcConfig: meeting.getWebRTCConfig()
      };

      res.json(diagnostics);
    });
  };

  // Socket.IO connection handling
  io.on('connection', (socket) => {
    const pollHandlers = setupPollSocketHandlers(socket);
    
    console.log('User connected:', socket.id, 'from IP:', socket.handshake.address);

    // Setup module handlers
    setupConnectionHandlers(io, socket);
    const { addParticipant, removeParticipant } = setupParticipantHandlers(io, socket);
    setupMediaHandlers(io, socket);

    // Meeting name change event
    socket.on('change-meeting-name', (data) => {
      const validation = validateData(data, ['newName']);
      if (!validation.isValid) {
        socket.emit('action-error', { message: validation.error });
        return;
      }

      const { newName } = data;
      const participantInfo = participants.get(socket.id);
      
      if (!participantInfo) {
        socket.emit('action-error', { message: 'Participant not found' });
        return;
      }

      const meeting = meetings.get(participantInfo.meetingId);
      if (!meeting) {
        socket.emit('action-error', { message: 'Meeting not found' });
        return;
      }

      if (!meeting.canChangeMeetingName(socket.id)) {
        socket.emit('action-error', { message: 'Only host can change meeting name' });
        return;
      }

      if (!newName || newName.trim().length === 0 || newName.length > 100) {
        socket.emit('action-error', { message: 'Invalid meeting name' });
        return;
      }
      
      const oldName = meeting.getMeetingName();
      const success = meeting.updateMeetingName(newName);
      
      if (success) {
        console.log(`Meeting ${participantInfo.meetingId} name changed from "${oldName}" to "${newName}" by ${socket.id}`);
        
        io.to(participantInfo.meetingId).emit('meeting-name-changed', {
          oldName: oldName,
          newName: meeting.getMeetingName(),
          changedBy: meeting.participants.get(socket.id)?.name
        });
      } else {
        socket.emit('action-error', { message: 'Failed to update meeting name' });
      }
    });

    // Join as host
    socket.on('join-as-host', async (data) => {
      const validation = validateData(data, ['meetingId', 'hostName']);
      if (!validation.isValid) {
        socket.emit('meeting-error', { message: validation.error });
        return;
      }

      const { meetingId, hostName, userId, meetingName } = data;
      
      try {
        if (userId) {
          const recordingName = meetingName || `${hostName}'s Meeting`;
          await recordMeetingStart(userId, meetingId, recordingName, true);
          await recordMeetingParticipant(userId, 1);
          
          socket.emit('meeting-started', {
            meetingId: meetingId,
            meetingName: recordingName,
            userId: userId,
            isHost: true
          });
        }
      } catch (error) {
        console.error('Error recording meeting start:', error);
      }
      
      const meeting = new Meeting(meetingId, socket.id, hostName);
      
      if (meetingName && meetingName.trim().length > 0) {
        meeting.meetingName = meetingName.trim();
      }
      
      meetings.set(meetingId, meeting);
      addParticipant(meeting, socket.id, hostName, true);
      socket.join(meetingId);
      participants.set(socket.id, { meetingId, isHost: true });
      socket.currentRoom = meetingId;
      socket.userId = userId;
      
      socket.emit('joined-meeting', {
        meetingId,
        isHost: true,
        participants: Array.from(meeting.participants.values()),
        spotlightedParticipant: meeting.spotlightedParticipant,
        raisedHands: Array.from(meeting.raisedHands),
        iceServers: meeting.iceServers,
        webrtcConfig: meeting.getWebRTCConfig(),
        isLocked: meeting.isLocked,
        permissions: meeting.getPermissions(),
        meetingName: meeting.getMeetingName()
      });

      console.log(`Host ${hostName} created meeting ${meetingId} with name "${meeting.getMeetingName()}"`);
    });

    // Join meeting
    socket.on('join-meeting', async (data) => {
      const validation = validateData(data, ['meetingId', 'participantName']);
      if (!validation.isValid) {
        socket.emit('meeting-error', { message: validation.error });
        return;
      }

      const { meetingId, participantName, userId } = data;
      const meeting = meetings.get(meetingId);
      
      if (!meeting) {
        socket.emit('meeting-error', { message: 'Meeting not found' });
        return;
      }

      if (meeting.isLocked && !meeting.participants.has(socket.id)) {
        socket.emit('meeting-locked', { 
          message: 'The host disabled New Entries, Meeting Inaccessible',
          meetingId: meetingId
        });
        return;
      }

      try {
        if (userId) {
          await recordMeetingStart(userId, meetingId, meeting.getMeetingName(), false);
          
          socket.emit('participant-joined-meeting', {
            meetingId: meetingId,
            meetingName: meeting.getMeetingName(),
            userId: userId
          });
        }
        
        const hostParticipant = Array.from(meeting.participants.values()).find(p => p.isHost);
        if (hostParticipant && hostParticipant.socketId) {
          const hostInfo = participants.get(hostParticipant.socketId);
          if (hostInfo && hostInfo.userId) {
            await recordMeetingParticipant(hostInfo.userId, 1);
          }
        }
      } catch (error) {
        console.error('Error recording meeting start:', error);
      }

      addParticipant(meeting, socket.id, participantName);
      socket.join(meetingId);
      participants.set(socket.id, { meetingId, isHost: false });
      socket.currentRoom = meetingId;
      socket.userId = userId;
      
      socket.emit('joined-meeting', {
        meetingId,
        isHost: false,
        participants: Array.from(meeting.participants.values()),
        spotlightedParticipant: meeting.spotlightedParticipant,
        screenShares: Array.from(meeting.screenShares.entries()),
        raisedHands: Array.from(meeting.raisedHands),
        iceServers: meeting.iceServers,
        webrtcConfig: meeting.getWebRTCConfig(),
        isLocked: meeting.isLocked,
        permissions: meeting.getPermissions(),
        meetingName: meeting.getMeetingName()
      });

      socket.to(meetingId).emit('participant-joined', {
        participant: meeting.participants.get(socket.id),
        participants: Array.from(meeting.participants.values())
      });

      console.log(`Participant ${participantName} joined meeting ${meetingId} ("${meeting.getMeetingName()}")`);
    });

    // Toggle meeting lock
    socket.on('toggle-meeting-lock', (data) => {
      const validation = validateData(data, ['isLocked']);
      if (!validation.isValid) {
        socket.emit('action-error', { message: validation.error });
        return;
      }

      const { isLocked } = data;
      const participantInfo = participants.get(socket.id);
      
      if (!participantInfo) return;
      
      const meeting = meetings.get(participantInfo.meetingId);
      if (!meeting || !meeting.canPerformHostAction(socket.id)) {
        socket.emit('action-error', { message: 'Only host can lock/unlock the meeting' });
        return;
      }

      if (isLocked) {
        meeting.lockMeeting();
      } else {
        meeting.unlockMeeting();
      }

      io.to(participantInfo.meetingId).emit('meeting-lock-changed', {
        isLocked: meeting.isLocked,
        changedBy: meeting.participants.get(socket.id)?.name
      });

      console.log(`Meeting ${participantInfo.meetingId} ${isLocked ? 'locked' : 'unlocked'} by ${socket.id}`);
    });

    // Update meeting permissions
    socket.on('update-meeting-permissions', (data) => {
      const validation = validateData(data, ['permissions']);
      if (!validation.isValid) {
        socket.emit('action-error', { message: validation.error });
        return;
      }

      const { permissions } = data;
      const participantInfo = participants.get(socket.id);
      
      if (!participantInfo) return;
      
      const meeting = meetings.get(participantInfo.meetingId);
      if (!meeting || !meeting.canPerformHostAction(socket.id)) {
        socket.emit('action-error', { message: 'Only host can update meeting permissions' });
        return;
      }

      meeting.updatePermissions(permissions);

      io.to(participantInfo.meetingId).emit('meeting-permissions-updated', {
        permissions: meeting.getPermissions(),
        changedBy: meeting.participants.get(socket.id)?.name,
        participants: Array.from(meeting.participants.values())
      });

      if (permissions.hasOwnProperty('allowRename')) {
        io.to(participantInfo.meetingId).emit('rename-permission-updated', {
          permissions: { allowRename: permissions.allowRename },
          changedBy: meeting.participants.get(socket.id)?.name
        });
      }

      console.log(`Meeting ${participantInfo.meetingId} permissions updated by ${socket.id}:`, permissions);
    });

    // End meeting for all
    socket.on('end-meeting-for-all', async (data) => {
      const validation = validateData(data, ['meetingId']);
      if (!validation.isValid) {
        socket.emit('action-error', { message: validation.error });
        return;
      }

      const { meetingId, reason } = data;
      const participantInfo = participants.get(socket.id);
      
      if (!participantInfo) return;
      
      const meeting = meetings.get(meetingId);
      if (!meeting) return;

      const participant = meeting.participants.get(socket.id);
      if (!participant || !participant.isHost) {
        socket.emit('action-error', { message: 'Only host can end meeting for everyone' });
        return;
      }

      console.log(`Host ${socket.id} ending meeting ${meetingId} for everyone`);

      if (socket.userId) {
        const participantCount = meeting.participants.size;
        await recordMeetingEnd(socket.userId, meetingId, participantCount)
          .catch(error => console.error('Error recording meeting end:', error));
      }

      io.to(meetingId).emit('meeting-ended', {
        reason: reason || 'host-ended',
        hostName: participant.name,
        message: 'The host has ended the meeting for everyone'
      });

      meetings.delete(meetingId);
      
      meeting.participants.forEach((p, socketId) => {
        participants.delete(socketId);
      });

      console.log(`Meeting ${meetingId} ended for everyone by host`);
    });

    // Host leave meeting
    socket.on('host-leave-meeting', async (data) => {
      const validation = validateData(data, ['meetingId']);
      if (!validation.isValid) {
        socket.emit('action-error', { message: validation.error });
        return;
      }

      const { meetingId, userId } = data;
      const participantInfo = participants.get(socket.id);
      
      if (!participantInfo) return;
      
      const meeting = meetings.get(meetingId);
      if (!meeting) return;

      const participant = meeting.participants.get(socket.id);
      if (!participant || !participant.isHost) {
        socket.emit('action-error', { message: 'Invalid request' });
        return;
      }

      console.log(`Host ${socket.id} leaving meeting ${meetingId} (meeting continues)`);

      if (userId) {
        const participantCount = meeting.participants.size;
        await recordMeetingEnd(userId, meetingId, participantCount)
          .catch(error => console.error('Error recording meeting end:', error));
      }

      const hostName = participant.name;

      removeParticipant(meeting, socket.id);
      participants.delete(socket.id);

      // Transfer host to first co-host, or first participant if no co-hosts
      let newHost = null;
      for (const [socketId, p] of meeting.participants) {
        if (p.isCoHost) {
          newHost = p;
          break;
        }
      }

      if (!newHost && meeting.participants.size > 0) {
        newHost = Array.from(meeting.participants.values())[0];
      }

      if (newHost) {
        newHost.isHost = true;
        newHost.isCoHost = false;
        meeting.hostId = newHost.socketId;
        meeting.hostName = newHost.name;

        console.log(`Host transferred to ${newHost.socketId} (${newHost.name})`);

        io.to(meetingId).emit('host-left', {
          oldHostName: hostName,
          newHost: {
            socketId: newHost.socketId,
            name: newHost.name
          },
          participants: Array.from(meeting.participants.values()),
          message: `${hostName} left the meeting. ${newHost.name} is now the host.`
        });

        io.to(newHost.socketId).emit('made-host', {
          message: 'You are now the host of this meeting'
        });
      } else {
        console.log(`Meeting ${meetingId} has no participants left, deleting`);
        meetings.delete(meetingId);
      }

      socket.to(meetingId).emit('participant-left', {
        socketId: socket.id,
        participantName: hostName,
        participants: Array.from(meeting.participants.values()),
        reason: 'host-left'
      });

      console.log(`Host ${socket.id} (${hostName}) left meeting ${meetingId}`);
    });

    // Disconnect
    socket.on('disconnect', (reason) => {
      if (pollHandlers && pollHandlers.handlePollDisconnect) {
        pollHandlers.handlePollDisconnect();
      }
      
      const participantInfo = participants.get(socket.id);

      console.log(`User disconnected: ${socket.id}, reason: ${reason}`);

      if (socket.currentRoom && socket.userId) {
        const meeting = meetings.get(socket.currentRoom);
        const participantCount = meeting ? meeting.participants.size : 1;

        recordMeetingEnd(socket.userId, socket.currentRoom, participantCount)
          .catch(error => console.error('Error recording meeting end:', error));
      }

      if (participantInfo) {
        const meeting = meetings.get(participantInfo.meetingId);

        if (meeting) {
          const participant = meeting.participants.get(socket.id);
          const participantName = participant?.name;

          const connectedParticipants = Array.from(meeting.participants.keys())
            .filter(id => id !== socket.id);

          removeParticipant(meeting, socket.id);

          if (participantInfo.isHost) {
            io.to(participantInfo.meetingId).emit('meeting-ended', {
              reason: 'host-disconnected',
              hostName: participantName
            });

            connectedParticipants.forEach(participantId => {
              const participantSocket = io.sockets.sockets.get(participantId);
              if (participantSocket) {
                participantSocket.emit('peer-disconnected', {
                  socketId: socket.id,
                  isHost: true
                });
              }
            });

            meetings.delete(participantInfo.meetingId);

            console.log(`Meeting ${participantInfo.meetingId} ended - host disconnected`);
          } else {
            io.to(participantInfo.meetingId).emit('participant-left', {
              socketId: socket.id,
              participantName: participantName,
              participants: Array.from(meeting.participants.values()),
              reason: reason
            });

            connectedParticipants.forEach(participantId => {
              const participantSocket = io.sockets.sockets.get(participantId);
              if (participantSocket) {
                participantSocket.emit('peer-disconnected', {
                  socketId: socket.id,
                  participantName: participantName
                });
              }
            });

            console.log(`Participant ${socket.id} (${participantName}) left meeting ${participantInfo.meetingId}`);
          }
        }

        participants.delete(socket.id);
      }
    });

    // Error handling
    socket.on('error', (error) => {
      console.error(`Socket error for ${socket.id}:`, error);
      socket.emit('socket-error', {
        message: 'Connection error occurred',
        timestamp: new Date().toISOString()
      });
    });
  });

  return { io, setupMeetingRoutes };
};