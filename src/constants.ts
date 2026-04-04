export interface RadioStation {
  id: string;
  name: string;
  url: string;
  genre: string;
  country: string;
  logo: string;
}

export const RADIO_STATIONS: RadioStation[] = [
  {
    id: '1',
    name: 'Lo-Fi Girl',
    url: 'https://play.streamafrica.net/lofi',
    genre: 'Lo-Fi',
    country: 'Global',
    logo: 'https://picsum.photos/seed/lofi/200/200'
  },
  {
    id: '2',
    name: 'BBC Radio 1',
    url: 'https://stream.live.vc.bbc.co.uk/bbc_radio_one',
    genre: 'Pop',
    country: 'UK',
    logo: 'https://picsum.photos/seed/bbc1/200/200'
  },
  {
    id: '3',
    name: 'Jazz24',
    url: 'https://live.jazz24.org/jazz24',
    genre: 'Jazz',
    country: 'USA',
    logo: 'https://picsum.photos/seed/jazz/200/200'
  },
  {
    id: '4',
    name: 'KEXP',
    url: 'https://kexp-mp3-128.streamguys1.com/kexp128.mp3',
    genre: 'Alternative',
    country: 'USA',
    logo: 'https://picsum.photos/seed/kexp/200/200'
  },
  {
    id: '5',
    name: 'FIP',
    url: 'https://stream.radiofrance.fr/fip/fip.m3u8?id=radiofrance',
    genre: 'Eclectic',
    country: 'France',
    logo: 'https://picsum.photos/seed/fip/200/200'
  },
  {
    id: '6',
    name: 'SomaFM - Groove Salad',
    url: 'https://ice1.somafm.com/groovesalad-128-mp3',
    genre: 'Ambient',
    country: 'USA',
    logo: 'https://picsum.photos/seed/soma/200/200'
  },
  {
    id: '7',
    name: 'Antena 1',
    url: 'https://stream.antena1.com.br/antena1.mp3',
    genre: 'Adult Contemporary',
    country: 'Brazil',
    logo: 'https://picsum.photos/seed/antena1/200/200'
  },
  {
    id: '8',
    name: 'Radio Rock',
    url: 'https://stream.radiorock.com.br/radiorock.mp3',
    genre: 'Rock',
    country: 'Brazil',
    logo: 'https://picsum.photos/seed/rock/200/200'
  }
];
