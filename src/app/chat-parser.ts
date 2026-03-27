import { Injectable } from '@angular/core';

export enum MessageType {
  TEXT = 'text',
  IMAGE_OMITTED = 'image_omitted',
  VIDEO_OMITTED = 'video_omitted',
  AUDIO_OMITTED = 'audio_omitted',
  STICKER_OMITTED = 'sticker_omitted',
  DOCUMENT_OMITTED = 'document_omitted',
  GIF_OMITTED = 'gif_omitted',
  LOCATION_OMITTED = 'location_omitted',
  CONTACT_OMITTED = 'contact_omitted',
  MISSED_CALL = 'missed_call',
  CALL_DURATION = 'call_duration',
  DELETED = 'deleted',
  SYSTEM = 'system'
}

export interface Participant {
  id: string;
  fullName: string;
  initials: string;
  isSelf: boolean;
  color: string;
  messageCount: number;
}

export interface Message {
  id: string;
  timestamp: number; // For sorting
  displayDate: string; // e.g. "September 18, 2023"
  time: string; // e.g. "22:09"
  senderId: string;
  senderName: string;
  content: string;
  type: MessageType;
}

@Injectable({
  providedIn: 'root'
})
export class ChatParserService {
  // WhatsApp Web colors for participants in group chats
  private colors = [
    '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
    '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
    '#00a884', '#53bdeb', '#ffbc00', '#eb407a', '#a3d400'
  ];

  private mediaPatterns: { pattern: RegExp, type: MessageType }[] = [
    { pattern: /(Bild|Image|Photo)\s+(weggelassen|omitted|ausgelassen)/i, type: MessageType.IMAGE_OMITTED },
    { pattern: /(Video)\s+(weggelassen|omitted|ausgelassen)/i, type: MessageType.VIDEO_OMITTED },
    { pattern: /(Audio|Sprachnachricht|Voice message)\s+(weggelassen|omitted|ausgelassen)/i, type: MessageType.AUDIO_OMITTED },
    { pattern: /(Sticker)\s+(weggelassen|omitted|ausgelassen)/i, type: MessageType.STICKER_OMITTED },
    { pattern: /(Dokument|Document)\s+(weggelassen|omitted|ausgelassen)/i, type: MessageType.DOCUMENT_OMITTED },
    { pattern: /(GIF)\s+(weggelassen|omitted|ausgelassen)/i, type: MessageType.GIF_OMITTED },
    { pattern: /(Standort|Location)\s+(weggelassen|omitted|ausgelassen)/i, type: MessageType.LOCATION_OMITTED },
    { pattern: /(Kontaktdaten|Contact|Kontaktkarte)\s+(weggelassen|omitted|ausgelassen)/i, type: MessageType.CONTACT_OMITTED }
  ];

  private specialPatterns: { pattern: RegExp, type: MessageType, label?: string }[] = [
    { pattern: /Verpasster\s+Sprachanruf|Missed\s+voice\s+call/i, type: MessageType.MISSED_CALL, label: 'Missed voice call' },
    { pattern: /Verpasster\s+Videoanruf|Missed\s+video\s+call/i, type: MessageType.MISSED_CALL, label: 'Missed video call' },
    { pattern: /(Sprachanruf|Videoanruf)\.\s*\d+/i, type: MessageType.CALL_DURATION },
    { pattern: /Anruf\s+fehlgeschlagen/i, type: MessageType.MISSED_CALL, label: 'Call failed' },
    { pattern: /Diese\s+Nachricht\s+wurde\s+gelöscht|This\s+message\s+was\s+deleted/i, type: MessageType.DELETED, label: 'This message was deleted' },
    { pattern: /Du\s+hast\s+diese\s+Nachricht\s+gelöscht|You\s+deleted\s+this\s+message/i, type: MessageType.DELETED, label: 'You deleted this message' }
  ];

  private systemTranslations: Record<string, string> = {
    'Nachrichten und Anrufe sind Ende-zu-Ende-verschlüsselt': 'Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them. Click to learn more.',
    'Du hast diese Nachricht gelöscht': 'You deleted this message',
    'Diese Nachricht wurde gelöscht': 'This message was deleted',
    'Sicherheitsnummer hat sich geändert': 'Security code changed',
    'hat die Gruppe verlassen': 'left the group',
    'hat dich hinzugefügt': 'added you',
    'hat die Gruppenbeschreibung geändert': 'changed the group description'
  };

  parse(text: string): { messages: Message[], participants: Participant[] } {
    const lines = text.split(/\r?\n/);
    const messages: Message[] = [];
    const participantMap = new Map<string, Participant>();
    
    // Improved regex to handle various timestamp formats and separators
    const messageRegex = /^\[?(\d{1,4}[./-]\d{1,4}[./-]\d{2,4}),\s+(\d{1,2}:\d{1,2}(?::\d{1,2})?(?:\s?[ap]m)?)\]?[\s-:]+(.*?):\s+(.*)$/i;
    const systemRegex = /^\[?(\d{1,4}[./-]\d{1,4}[./-]\d{2,4}),\s+(\d{1,2}:\d{1,2}(?::\d{1,2})?(?:\s?[ap]m)?)\]?[\s-:]+(.*)$/i;

    let currentMessage: Message | null = null;

    for (const line of lines) {
      if (!line.trim()) continue;

      // Strip invisible LRM/RLM characters that often appear in WhatsApp exports
      const sanitizedLine = line.replace(/[\u200e\u200f]/g, '');
      const match = sanitizedLine.match(messageRegex);

      if (match) {
        const [, dateStr, timeStr, senderName, content] = match;
        const timestamp = this.parseDate(dateStr, timeStr);
        const { type, cleanContent } = this.detectMessageType(content);

        currentMessage = {
          id: Math.random().toString(36).substring(2, 11),
          timestamp,
          displayDate: this.formatDisplayDate(timestamp),
          time: this.formatTime(timeStr),
          senderId: senderName.trim(),
          senderName: senderName.trim(),
          content: cleanContent,
          type
        };

        messages.push(currentMessage);

        const pId = senderName.trim();
        const p = participantMap.get(pId);
        if (p) {
          p.messageCount++;
        } else {
          participantMap.set(pId, {
            id: pId,
            fullName: pId,
            initials: this.getInitials(pId),
            isSelf: false,
            color: this.colors[participantMap.size % this.colors.length],
            messageCount: 1
          });
        }
      } else {
        const sysMatch = sanitizedLine.match(systemRegex);
        if (sysMatch) {
          const [, dateStr, timeStr, content] = sysMatch;
          const timestamp = this.parseDate(dateStr, timeStr);
          
          messages.push({
            id: Math.random().toString(36).substring(2, 11),
            timestamp,
            displayDate: this.formatDisplayDate(timestamp),
            time: this.formatTime(timeStr),
            senderId: 'system',
            senderName: 'System',
            content: this.translateSystemMessage(content.trim()),
            type: MessageType.SYSTEM
          });
          currentMessage = null;
        } else if (currentMessage) {
          // Multiline continuation
          currentMessage.content += '\n' + line.replace(/[\u200e\u200f]/g, '');
        }
      }
    }

    messages.sort((a, b) => a.timestamp - b.timestamp);

    return {
      messages,
      participants: Array.from(participantMap.values()).sort((a, b) => b.messageCount - a.messageCount)
    };
  }

  private translateSystemMessage(content: string): string {
    for (const [german, english] of Object.entries(this.systemTranslations)) {
      if (content.includes(german)) {
        return content.replace(german, english);
      }
    }
    return content;
  }

  private detectMessageType(content: string): { type: MessageType, cleanContent: string } {
    // Strip invisible characters before detection
    const sanitized = content.replace(/[\u200e\u200f]/g, '').trim();

    // Check special patterns first (calls, deleted)
    for (const { pattern, type, label } of this.specialPatterns) {
      if (pattern.test(sanitized)) {
        return { type, cleanContent: label || sanitized };
      }
    }

    // Check media patterns
    for (const { pattern, type } of this.mediaPatterns) {
      if (pattern.test(sanitized)) {
        // If it's a document with a filename, try to preserve the filename
        if (type === MessageType.DOCUMENT_OMITTED && sanitized.includes('•')) {
          const parts = sanitized.split('•');
          return { type, cleanContent: parts[0].trim() + ' (Document omitted)' };
        }

        // Map to standard English label
        const label = type.replace('_omitted', ' omitted').replace('_', ' ');
        return { 
          type, 
          cleanContent: label.charAt(0).toUpperCase() + label.slice(1) 
        };
      }
    }
    return { type: MessageType.TEXT, cleanContent: sanitized };
  }

  private parseDate(dateStr: string, timeStr: string): number {
    const dateParts = dateStr.split(/[./-]/);
    let day, month, year;

    if (dateParts[0].length === 4) {
      // yyyy-mm-dd
      [year, month, day] = dateParts;
    } else {
      // dd.mm.yy or mm/dd/yyyy
      [day, month, year] = dateParts;
      if (year.length === 2) year = '20' + year;
    }

    // Handle 12h format if present
    let hours = 0, minutes = 0, seconds = 0;
    const timeMatch = timeStr.match(/(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(\s?[ap]m)?/i);
    if (timeMatch) {
      hours = parseInt(timeMatch[1]);
      minutes = parseInt(timeMatch[2]);
      seconds = parseInt(timeMatch[3] || '0');
      const ampm = timeMatch[4]?.toLowerCase().trim();
      if (ampm === 'pm' && hours < 12) hours += 12;
      if (ampm === 'am' && hours === 12) hours = 0;
    }

    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), hours, minutes, seconds);
    return date.getTime();
  }

  private formatTime(timeStr: string): string {
    // Normalize to HH:mm
    const match = timeStr.match(/(\d{1,2}):(\d{1,2})/);
    if (!match) return timeStr;
    return `${match[1].padStart(2, '0')}:${match[2].padStart(2, '0')}`;
  }

  private getInitials(name: string): string {
    const parts = name.split(/[\s._-]+/).filter(p => p.length > 0 && !/^\W+$/.test(p));
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  }

  private formatDisplayDate(timestamp: number): string {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    
    if (date.toDateString() === now.toDateString()) return 'Today';
    
    const yesterday = new Date();
    yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';

    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }
}
