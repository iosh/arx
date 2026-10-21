export type MnemonicWord = Readonly<{
  position: number;
  word: string;
}>;

function pickRandom<T>(values: readonly T[], count: number): T[] {
  const remaining = [...values];
  const picked: T[] = [];
  for (let index = 0; index < count; index += 1) {
    const randomIndex = Math.floor(Math.random() * remaining.length);
    picked.push(...remaining.splice(randomIndex, 1));
  }
  return picked;
}

export function buildMnemonicQuiz(words: readonly MnemonicWord[]) {
  const uniqueWords = [...new Set(words.map(({ word }) => word))];

  const questionWords = pickRandom(words, 3);
  questionWords.sort((left, right) => left.position - right.position);

  return questionWords.map(({ word: answer, position }) => {
    const otherWords = uniqueWords.filter((word) => word !== answer);
    const choices = pickRandom(otherWords, Math.min(2, otherWords.length));
    const answerIndex = Math.floor(Math.random() * (choices.length + 1));
    choices.splice(answerIndex, 0, answer);

    return {
      position,
      answer,
      choices,
    };
  });
}
