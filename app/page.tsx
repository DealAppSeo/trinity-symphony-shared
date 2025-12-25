const handleAnalyze = async () => {
  console.log('handleAnalyze started', { isValid, textLength: text.length });
  if (!isValid) return
  setIsLoading(true)
  console.log('About to fetch');
  try {
    const response = await fetch(...)
    console.log('Fetch response:', response.status);
    // rest
  } catch (error) {
    console.error('Fetch error:', error);
    alert(...)
  } finally {
    setIsLoading(false)
  }
}
