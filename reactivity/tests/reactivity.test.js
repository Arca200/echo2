function sum(a, b) {
    return a + b
}

test('test', () => {
    expect(sum(1, 2)).toBe(3)
})