/**
 * Beispiel-Daten für Activities.
 * Später kommen diese Daten aus der Laravel-API statt aus dieser Datei.
 */

export type Activity = {
  id: string;
  title: string;
  category: string;
  emoji: string;
  location: string;
  date: string;
  participants: number;
  maxParticipants: number;
  host: string;
};

export const ACTIVITIES: Activity[] = [
  {
    id: '1',
    title: 'Feierabend-Fußball im Park',
    category: 'Sport',
    emoji: '⚽',
    location: 'Stadtpark, Köln',
    date: 'Heute, 18:00',
    participants: 8,
    maxParticipants: 12,
    host: 'Marco',
  },
  {
    id: '2',
    title: 'Brettspiel-Abend',
    category: 'Games',
    emoji: '🎲',
    location: 'Café Löffel, Ehrenfeld',
    date: 'Morgen, 19:30',
    participants: 5,
    maxParticipants: 6,
    host: 'Lisa',
  },
  {
    id: '3',
    title: 'Sonntags-Wanderung',
    category: 'Outdoor',
    emoji: '🥾',
    location: 'Siebengebirge',
    date: 'So, 10:00',
    participants: 3,
    maxParticipants: 10,
    host: 'Jonas',
  },
  {
    id: '4',
    title: 'Gemeinsam Kochen: Ramen',
    category: 'Food',
    emoji: '🍜',
    location: 'Südstadt',
    date: 'Fr, 18:30',
    participants: 4,
    maxParticipants: 4,
    host: 'Aylin',
  },
  {
    id: '5',
    title: 'Fotowalk durch die Altstadt',
    category: 'Kreativ',
    emoji: '📷',
    location: 'Altstadt, Köln',
    date: 'Sa, 14:00',
    participants: 6,
    maxParticipants: 15,
    host: 'Ben',
  },
];
