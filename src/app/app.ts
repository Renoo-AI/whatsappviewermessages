import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, signal, computed, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { ChatParserService, Message, Participant, MessageType } from './chat-parser';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private parser = inject(ChatParserService);
  MessageType = MessageType;
  
  @ViewChild('scrollContainer') scrollContainer!: ElementRef;

  messages = signal<Message[]>([]);
  participants = signal<Participant[]>([]);
  selfId = signal<string | null>(null);
  searchQuery = signal<string>('');
  isLoading = signal<boolean>(false);
  hasUploaded = signal<boolean>(false);
  showJumpToBottom = signal<boolean>(false);
  showStats = signal<boolean>(false);
  currentTime = signal<number>(Date.now());

  // Computed values
  chatAge = computed(() => {
    const msgs = this.messages();
    if (msgs.length === 0) return null;

    const start = msgs[0].timestamp;
    const now = this.currentTime();
    const diff = now - start;

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const months = Math.floor(days / 30.44);
    const years = Math.floor(days / 365.25);

    return {
      years,
      months: months % 12,
      days: Math.floor(days % 30.44),
      hours: hours % 24,
      minutes: minutes % 60,
      seconds: seconds % 60
    };
  });

  chatStats = computed(() => {
    const msgs = this.messages();
    if (msgs.length === 0) return null;

    const start = msgs[0].timestamp;
    const end = msgs[msgs.length - 1].timestamp;
    const durationMs = end - start;

    const seconds = Math.floor(durationMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const months = Math.floor(days / 30.44); // Average month length
    const years = Math.floor(days / 365.25);

    let durationStr = '';
    if (years > 0) {
      durationStr = `${years} year${years > 1 ? 's' : ''}${months % 12 > 0 ? `, ${months % 12} month${months % 12 > 1 ? 's' : ''}` : ''}`;
    } else if (months > 0) {
      durationStr = `${months} month${months > 1 ? 's' : ''}${days % 30 > 0 ? `, ${Math.floor(days % 30.44)} day${Math.floor(days % 30.44) > 1 ? 's' : ''}` : ''}`;
    } else {
      durationStr = `${days} day${days > 1 ? 's' : ''}`;
    }

    return {
      startDate: new Date(start),
      endDate: new Date(end),
      duration: durationStr,
      totalMessages: msgs.length,
      mediaCount: msgs.filter(m => m.type !== MessageType.TEXT).length,
      daysCount: days,
      monthsCount: months,
      yearsCount: years
    };
  });

  formatFullDate(timestamp: number): string {
    return new Date(timestamp).toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  chatTimeline = computed(() => {
    const msgs = this.messages();
    const months: { label: string, timestamp: number }[] = [];
    let lastMonth = '';

    msgs.forEach(m => {
      const date = new Date(m.timestamp);
      const label = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
      if (label !== lastMonth) {
        months.push({ label, timestamp: m.timestamp });
        lastMonth = label;
      }
    });

    return months;
  });

  filteredMessages = computed(() => {
    const query = this.searchQuery().toLowerCase().trim();
    const allMessages = this.messages();
    if (!query) return allMessages;
    return allMessages.filter(m => 
      m.content.toLowerCase().includes(query) || 
      m.senderName.toLowerCase().includes(query)
    );
  });

  groupedMessages = computed(() => {
    const msgs = this.filteredMessages();
    const groups: { date: string, messages: Message[] }[] = [];
    let currentGroup: { date: string, messages: Message[] } | null = null;

    msgs.forEach(m => {
      if (!currentGroup || currentGroup.date !== m.displayDate) {
        currentGroup = { date: m.displayDate, messages: [] };
        groups.push(currentGroup);
      }
      currentGroup.messages.push(m);
    });

    return groups;
  });

  chatTitle = computed(() => {
    const parts = this.participants();
    const sid = this.selfId();
    const others = parts.filter(p => p.id !== sid);
    
    if (others.length === 1) return others[0].fullName;
    if (others.length === 0) return 'Me';
    return others.map(o => o.fullName.split(' ')[0]).join(', ');
  });

  otherParticipant = computed(() => {
    const parts = this.participants();
    const sid = this.selfId();
    const others = parts.filter(p => p.id !== sid);
    return others.length === 1 ? others[0] : null;
  });

  constructor() {
    // Update current time every second for the chat age timer
    setInterval(() => {
      this.currentTime.set(Date.now());
    }, 1000);

    // Scroll to bottom when messages change
    effect(() => {
      if (this.messages().length > 0) {
        // Use requestAnimationFrame for smoother scroll after render
        requestAnimationFrame(() => {
          this.scrollToBottom();
        });
      }
    });
  }

  async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;

    this.isLoading.set(true);
    const file = input.files[0];
    
    try {
      const text = await file.text();
      const result = this.parser.parse(text);
      
      this.messages.set(result.messages);
      this.participants.set(result.participants);
      
      // Heuristic: pick the participant with most messages as "not self" if only 2
      // Actually, let's pick the second most frequent as self by default if 2
      if (result.participants.length >= 2) {
        this.setSelf(result.participants[0].id);
      }
      
      this.hasUploaded.set(true);
    } catch (error) {
      console.error('Failed to parse file:', error);
      alert('Error parsing file. Ensure it is a valid WhatsApp export .txt file.');
    } finally {
      this.isLoading.set(false);
    }
  }

  setSelf(id: string) {
    this.selfId.set(id);
    this.participants.update(parts => parts.map(p => ({
      ...p,
      isSelf: p.id === id
    })));
  }

  scrollToBottom() {
    if (this.scrollContainer) {
      const el = this.scrollContainer.nativeElement;
      el.scrollTop = el.scrollHeight;
    }
  }

  getSenderColor(senderId: string): string {
    const p = this.participants().find(part => part.id === senderId);
    return p?.color || '#54656f';
  }

  loadDemoData() {
    const demoText = `[18.09.23, 22:09:44] Imen Azzouz: hello
[18.09.23, 22:09:51] Med.: hi..
[18.09.23, 22:10:05] Imen Azzouz: How are you doing?
[18.09.23, 22:10:15] Med.: I'm good, just working on a new project.
[18.09.23, 22:10:30] Imen Azzouz: ‎Bild weggelassen
[18.09.23, 22:10:45] Med.: That looks amazing!
[18.09.23, 22:11:00] Imen Azzouz: ‎Video weggelassen
[18.09.23, 22:11:10] Med.: Send me the link later.
[18.09.23, 22:11:30] Sarah: Hey guys! What's up?
[18.09.23, 22:11:45] Med.: Hey Sarah! We're just checking out Imen's new project.
[18.09.23, 22:12:00] Med.: Sprachanruf. 6 Sek.
[18.09.23, 22:12:15] Imen Azzouz: Verpasster Sprachanruf. Zum Zurückrufen tippen
[18.09.23, 22:12:30] Med.: Diese Nachricht wurde gelöscht.
[01.06.24, 21:53:03] Med.: Bild weggelassen
[01.06.24, 21:53:09] Med.: Video weggelassen
[18.09.23, 22:12:45] Imen Azzouz: 103 LUSAIL 78.pdf • 1 Seite Dokument weggelassen
[18.09.23, 22:13:00] Med.: Standort: https://maps.google.com/?q=25.292919,51.496502
[18.09.23, 22:13:15] Med.: I have to go now, talk to you later!
[18.09.23, 22:13:30] Imen Azzouz: Okay, bye!`;
    
    const result = this.parser.parse(demoText);
    this.messages.set(result.messages);
    this.participants.set(result.participants);
    this.setSelf('Med.');
    this.hasUploaded.set(true);
  }

  reset() {
    this.messages.set([]);
    this.participants.set([]);
    this.selfId.set(null);
    this.hasUploaded.set(false);
    this.searchQuery.set('');
    this.showJumpToBottom.set(false);
  }

  formatDisplayDate(timestamp: number): string {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date('2026-03-27T03:56:09Z'); // Use current date from context
    
    if (date.toDateString() === now.toDateString()) return 'Today';
    
    const yesterday = new Date();
    yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';

    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  jumpToDate(timestamp: number) {
    const dateStr = this.formatDisplayDate(timestamp);
    const elements = document.querySelectorAll('.system-message');
    for (const el of Array.from(elements) as HTMLElement[]) {
      if (el.innerText.includes(dateStr) || el.innerText.includes(new Date(timestamp).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }))) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        break;
      }
    }
  }

  onScroll(event: Event) {
    const el = event.target as HTMLElement;
    const threshold = 300;
    this.showJumpToBottom.set(el.scrollHeight - el.scrollTop - el.clientHeight > threshold);
  }

  getTimeAgo(timestamp: number): string {
    const now = new Date('2026-03-27T03:56:09Z').getTime(); // Use current date from context
    const diff = now - timestamp;
    
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const months = Math.floor(days / 30.44);
    const years = Math.floor(days / 365.25);

    if (years > 0) return `${years}y ago`;
    if (months > 0) return `${months}mo ago`;
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
  }

  highlightSearch(text: string): string {
    let processed = text;
    
    // Link detection
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    processed = processed.replace(urlRegex, '<a href="$1" target="_blank" class="text-[#027eb5] hover:underline">$1</a>');

    const query = this.searchQuery().trim();
    if (!query) return processed;
    const regex = new RegExp(`(${query})`, 'gi');
    return processed.replace(regex, '<mark class="bg-yellow-200 text-black px-0.5 rounded">$1</mark>');
  }
}
