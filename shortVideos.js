/**
 * MMC Career Readiness Grant™ 2027–28
 * Short Video Showcase Data Manifest
 * 
 * Maps actual local video assets from the project's videos/ directory.
 * Video-80900.mp4 is excluded because its binary hash is an exact duplicate of AQOHRva...mp4.
 */

const shortVideos = [
  {
    id: "vid-01",
    src: "videos/AQMIoMqaiFzL0XuZi-I-AvEI45IijNy2cFUqzF53m52K3OWBO9b2Fqih3cSnvmCYErMrXI0CVKiQT2xBUi9k4UsfsH-SeUaSoqNjxl0.mp4",
    title: "School Experience 1",
    label: "Watch school readiness workshop",
    tag: "School Visit"
  },
  {
    id: "vid-02",
    src: "videos/AQMPwmyhlnTNwqTuiUoTDoTXoHvKpn95OAuJFbXY-6LALJop_pJFsiu5-7IOt5PC9KnL2fk6cryfNl6ZRpHYDga16EqwfFYelKAu1ew.mp4",
    title: "School Experience 2",
    label: "Watch student interaction",
    tag: "Student Voice"
  },
  {
    id: "vid-03",
    src: "videos/AQN02gCZpDAK3YKK_1oO98Emp7iiSOazLJOv9y-lLlRxt6Lxdbu2KqAmJBy6QPtELFjIF9nMut4rftIm5MzuHoI4azm4fT2kC-X40T4.mp4",
    title: "School Experience 3",
    label: "Watch career session",
    tag: "Career Session"
  },
  {
    id: "vid-04",
    src: "videos/AQN5n_m_JekXlZBEWvPDqQvlqXarQdPqSd3rnXU1JEWoGJHrDPCM_acSEogBWoCFgS6_w5l26gLwcb4DqJu7-AcCTUbqnfkCwoh2XuE.mp4",
    title: "School Experience 4",
    label: "Watch career awareness activity",
    tag: "Activity"
  },
  {
    id: "vid-05",
    src: "videos/AQN6mMBk7e9taOVZOjtckz8QWN58UmWgyioI3Hm2-aTS0X_7mddRglSFoLGsrUDUOMbDZ-O3BYiZRSJnkAUECJz2pmLrkQ7mbdhPGVk.mp4",
    title: "School Experience 5",
    label: "Watch campus workshop",
    tag: "Workshop"
  },
  {
    id: "vid-06",
    src: "videos/AQNAK0-CfgfXwfpezJkMkFWhf7JOCgod6K8jLI0fAs1pORs1eL2f6oEfw5ThdEyWeSrFinHLDHypEYzGbzJCCvmBJdTMDIPiS3pQD7Q.mp4",
    title: "School Experience 6",
    label: "Watch guidance dialogue",
    tag: "Guidance"
  },
  {
    id: "vid-07",
    src: "videos/AQNkJgccUELI3QGciHzj80Dz2nnHrCtF-J6E1GyO-MiuuYKlfgKTvzzymYWu1pGNPWp0zg8DmeyGbng9Bwri8Sz-9smD62h5TXslh-U.mp4",
    title: "School Experience 7",
    label: "Watch student development glimpse",
    tag: "Development"
  },
  {
    id: "vid-08",
    src: "videos/AQNlvLit4W3RwZxov2D6iNRLid0DOjEfR2LFNY6rbhrurlmVy_KyBuGixOANfRaKxYCJOHIUnoixcVHyk-2wQIZegpwFQRZNUT0vMb4.mp4",
    title: "School Experience 8",
    label: "Watch school participation story",
    tag: "Participation"
  },
  {
    id: "vid-09",
    src: "videos/AQO8VW4lGbSMQ9p7FPD-Mc_2Ta57GIu4jiTjdJVdAr-w2ZxzmsvHiELAAbljuNrFgutEN6-HqZ-amuWhNUN8vnCHUptIESEiu6iMlYo.mp4",
    title: "School Experience 9",
    label: "Watch school interaction",
    tag: "School Visit"
  },
  {
    id: "vid-10",
    src: "videos/AQOcHKWwR89A4gsaQUum0gIIHtlBZGGjTXjDt2R6wNkfjoLBsuea2ulC1McweTM6WmxtAUzutjNRFqJcK_2pk3Rm4C7yF34AEV72_zE.mp4",
    title: "School Experience 10",
    label: "Watch career readiness spotlight",
    tag: "Readiness"
  },
  {
    id: "vid-11",
    src: "videos/AQOHRva-FDEW7fT4EdUJEtCsgzMhezjv_YLiD2kpKXvyYLNL_z8KzbI-4Iv4Ymve6yWgWmh8xQ_NSH_6Hjorw608cQ14Sdgf_bGcPdI.mp4",
    title: "School Experience 11",
    label: "Watch educator & student session",
    tag: "Session"
  },
  {
    id: "vid-12",
    src: "videos/AQOKFxrtb1LiMlbLA9rP8G8tXkUL3MSq1WlPUjHCSuMKBSpiKk9e_RhHuammWdJDKZ33td8iLZPBNJ4EUCiJps7L2bvcTs64DAJmPmU.mp4",
    title: "School Experience 12",
    label: "Watch student conversation",
    tag: "Conversation"
  },
  {
    id: "vid-13",
    src: "videos/AQOTD35WIuTq9egDWZok-hN2Q83epALZLjy7I-il0-OjZvvkOovHgIReUjCelKEBPSBAx3cMwahYE4gnMDu2seXYLumMdQiRdjIzVSM.mp4",
    title: "School Experience 13",
    label: "Watch school event highlight",
    tag: "Event"
  },
  {
    id: "vid-14",
    src: "videos/AQOUsmzlF5Bb_jK78YYprO69ceyKfurgWf_-UNkyugGrvBeUuKULF5eF85bSG3rhwYkI0ejo9eytj1i45yhQI3Ul7MINfPRcMUqEZM4.mp4",
    title: "School Experience 14",
    label: "Watch career awareness showcase",
    tag: "Awareness"
  },
  {
    id: "vid-15",
    src: "videos/AQOXOyuBlk9_DHCwKS1Pe0pWwSX85RkdxA0-qBE9zre-49efGiPpicd37D-bfa2CB-T-5qbpXesdG5Q6DYFrq6NAfds6AttCAoobD4Y.mp4",
    title: "School Experience 15",
    label: "Watch student guidance highlight",
    tag: "Guidance"
  },
  {
    id: "vid-16",
    src: "videos/AQPdL-gVGRCzSsYPYyTEtEcBbXri3hi5Qv7iLiaILYIxmOQw__ZE4tjc5u3OKJkFoCaajaBkc2UF3ldfc0OW4TknK7eN6Uu48vvL1Ts.mp4",
    title: "School Experience 16",
    label: "Watch student pathway talk",
    tag: "Student Voice"
  },
  {
    id: "vid-17",
    src: "videos/AQPFXzHQCzt3-C_2LEPvO_Wdc1RXWJwQcKLmCq7Ff5BuDWkdv6GwptRFujDoJXU4JIETrn7WcN1zIL_JccKn_n8ifqz_dl-owpNMLBs.mp4",
    title: "School Experience 17",
    label: "Watch school initiative glimpse",
    tag: "Initiative"
  },
  {
    id: "vid-18",
    src: "videos/AQPH8nZMv4ImlfHmMfTV1vAXvZtzQ2YKmpDZLn7eeuoYPQmBGUukf--RH7MjWXPlju29b4J3E-O5QJCTsP4zVjQka1BbjawZTwAmBJM.mp4",
    title: "School Experience 18",
    label: "Watch mentoring workshop",
    tag: "Mentoring"
  },
  {
    id: "vid-19",
    src: "videos/AQPIzpo98UimYtEyI0pbHWQ7RnKoQl0grDlTBeGYhCkhiQ4EVn9VV6e7AgtnDisPj74ee9mK2V9xkusTxMPjA34tAm7pyLeaZnNyKHw.mp4",
    title: "School Experience 19",
    label: "Watch student reaction",
    tag: "Student Voice"
  },
  {
    id: "vid-20",
    src: "videos/AQPKfbMdGMJzMver2HjZNAdFifoDh9I-lIoMk1BvRWZg1RRBJs7wZjFedz-j2ExDGD-xbHkv9afubvH9DJmcBYdXW-RKALjKDobCACc.mp4",
    title: "School Experience 20",
    label: "Watch future-ready school workshop",
    tag: "Workshop"
  },
  {
    id: "vid-21",
    src: "videos/AQPnizAhk_zMfZ8tGA8hIcamSONomqwImZQr-Ax6DQVn44CLiJDzJT2VSD-3W49qRYH2MjzotrMk4TCSqvpHjvb_NExPtAq9boWkdEs.mp4",
    title: "School Experience 21",
    label: "Watch school leadership interaction",
    tag: "Leadership"
  },
  {
    id: "vid-22",
    src: "videos/AQPUu3uF6cHGN0UuP_B5vGCUo8rw9kiJ-PiQdCX7JT-_fS8NqHCJb5Rkx1tYkLmsFE-zAhIg910is_0eySkyGb7QMD9OBgSroDs5SAA.mp4",
    title: "School Experience 22",
    label: "Watch student feedback",
    tag: "Feedback"
  },
  {
    id: "vid-23",
    src: "videos/Video-55562.mp4",
    title: "School Experience 23",
    label: "Watch career session summary",
    tag: "Session"
  },
  {
    id: "vid-24",
    src: "videos/Video-83565.mp4",
    title: "School Experience 24",
    label: "Watch programme moment",
    tag: "Moment"
  }
];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { shortVideos };
}
